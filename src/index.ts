import { Server } from "socket.io";
import { Sandbox } from "@e2b/code-interpreter";
import express from "express";
import "dotenv/config";
import { generateText, stepCountIs, streamText } from "ai";

import { google } from "@ai-sdk/google";
import { SYSTEM_PROMPT } from "./prompt.js";
import { updateFile, runCommand } from "../tools/index.js";
import cors from "cors";
import { CreateTreeFile } from "../helper/create-tree-file.js";
import { createServer } from "http";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client.js";
const connectionString = `${process.env.DATABASE_URL}`;
console.log("connectionString : ", connectionString);
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });
export { prisma };




const app = express();
app.use(cors());
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const accountName = process.env.AZURE_STORAGE_ACCOUNT!;
const accountKey = process.env.AZURE_STORAGE_KEY!;

const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);
const blobServiceClient = new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, sharedKeyCredential);

async function streamToBuffer(readableStream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on("data", (data) => chunks.push(data instanceof Buffer ? data : Buffer.from(data)));
    readableStream.on("end", () => resolve(Buffer.concat(chunks)));
    readableStream.on("error", reject);
  });
}

app.use(express.json());

io.on("connection", (socket) => {
  socket.on("syncFiles", async ({ sandboxId, userId, projectId }) => {
    console.log("syncing files....");
    try {
      socket.join(userId);
      console.log("userId : ", userId);
      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
      });
      console.log("user : ", user);

      if (!user) {
        io.to(userId).emit("user:error", { message: "User Not found" });
        return;
      }

      const project = await prisma.project.findUnique({
        where: {
          userId,
          id: projectId,
        },
      });

      if (!project) {
        io.to(userId).emit("project:error", { message: "Create Project First" });
        return;
      }

      if (!sandboxId) {
        io.to(userId).emit("sync:error", { message: "Sandbox Id needed" });
        return;
      }

      const sbx = await Sandbox.connect(sandboxId, {
        timeoutMs: 9_00_000,
      });

      await CreateTreeFile(sbx);

      const execution = await sbx.commands.run("node /tmp/getTree.js");
      const result = JSON.parse(execution.stdout);

      const containerName = "projects";
      const containerClient = blobServiceClient.getContainerClient(containerName);
      await containerClient.createIfNotExists();

      const uploadPromises = result.files.map(async (file: any) => {
        const blobName = `${projectId}/${file.path}`.replace(/\\/g, "/");

        console.log("blobName : ", blobName);

        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        const buffer = Buffer.from(file.code, "utf-8");

        await blockBlobClient.upload(buffer, buffer.length, {
          blobHTTPHeaders: { blobContentType: file.type || "text/plain" },
        });
      });

      await Promise.all(uploadPromises);

      io.to(userId).emit("sync:complete", {
        files: result.files,
        tree: result.tree,
      });
    } catch (err: any) {
      console.error("Error syncing files:", err);
      io.to(userId).emit("sync:error", { message: err.message });
    }
  });

  socket.on("startChat", async ({ prompt, messages, sandboxId, userId, projectId }) => {
    console.log("starting chat....");
    try {
      socket.join(userId);

      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
      });

      if (!user) {
        io.to(userId).emit("user:error", { message: "User Not found" });
        return;
      }

      let project = await prisma.project.findUnique({
        where: {
          userId,
          id: projectId,
        },
      });

      if (!project) {
        console.log("creating project for : ", projectId);
        project = await prisma.project.create({
          data: {
            id: projectId,
            name: "My App",
            userId: user.id,
          },
        });
      }

      await prisma.message.create({
        data: {
          projectId: project.id,
          role: "user",
          content: prompt,
        },
      });

      console.log("starting chat for : ", project.id);

      const sbx = sandboxId
        ? await Sandbox.connect(sandboxId)
        : await Sandbox.create("hmhu97yiefuboeu0an1l", { timeoutMs: 9_00_000 });

      const info = await sbx.getInfo();

      const host = sbx.getHost(5173);
      const url = `https://${host}`;

      io.to(userId).emit("sandbox:connected", { sandboxId: sbx.sandboxId, url });

      const emit = (event: string, data: any) => io.to(userId).emit(event, data);

      const response = streamText({
        model: google("gemini-2.5-flash"),
        system: SYSTEM_PROMPT,
        toolChoice: "required",
        tools: {
          updateFile: updateFile(sbx, emit),
          runCode: runCommand(sbx, emit),
        },
        messages,
        maxRetries: 0,
        stopWhen: stepCountIs(1),
      });

      // const result = await sbx.commands.run("npm install", {
      //   cwd: "/home/user",
      // });

      await prisma.message.create({
        data: {
          projectId: project.id,
          role: "assistant",
          content: JSON.stringify(await response.content, null, 2),
        },
      });

      emit("ai:done", {
        url,
        projectId: project.id,
        sandboxId: info.sandboxId,
        messages: [
          ...messages,
          {
            role: "assistant",
            content: JSON.stringify(await response.content, null, 2),
          },
        ],
      });

      // Auto-sync files to Azure after AI completes
      try {
        await CreateTreeFile(sbx);

        const execution = await sbx.commands.run("node /tmp/getTree.js");
        const result = JSON.parse(execution.stdout);

        const containerName = "projects";
        const containerClient = blobServiceClient.getContainerClient(containerName);
        await containerClient.createIfNotExists();

        const uploadPromises = result.files.map(async (file: any) => {
          const blobName = `${projectId}/${file.path}`.replace(/\\/g, "/");
          const blockBlobClient = containerClient.getBlockBlobClient(blobName);
          const buffer = Buffer.from(file.code, "utf-8");

          await blockBlobClient.upload(buffer, buffer.length, {
            blobHTTPHeaders: { blobContentType: file.type || "text/plain" },
          });
        });

        await Promise.all(uploadPromises);

        io.to(userId).emit("sync:complete", {
          files: result.files,
          tree: result.tree,
        });
      } catch (syncError: any) {
        console.error("Error auto-syncing files:", syncError);
        io.to(userId).emit("sync:error", { message: syncError.message });
      }
    } catch (err: any) {
      console.error("Error:", err);
      io.to(userId).emit("error", { message: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.post("/files", async (req, res) => {
  const { sandboxId, userId, projectId } = req.body;

  console.log("file for projectId : ", projectId);

  if (!sandboxId || !userId || !projectId) {
    return res.status(400).json({
      error: "sandboxId, userId, and projectId are required",
    });
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const project = await prisma.project.findUnique({
    where: {
      userId,
      id: projectId,
    },
  });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  try {
    const sbx = await Sandbox.connect(sandboxId, {
      timeoutMs: 9_00_000,
    });

    await CreateTreeFile(sbx);

    const execution = await sbx.commands.run("node /tmp/getTree.js");
    const result = JSON.parse(execution.stdout);

    return res.json({
      message: "success",
      files: result.files,
      tree: result.tree,
    });
  } catch (error: any) {
    console.error("Error uploading files:", error);
    return res.status(500).json({
      error: "Failed to upload files",
      details: error.message,
    });
  }
});

app.get("/startProject/:projectId", async (req, res) => {
  const { projectId } = req.params;
  let userId = req.headers["userid"];
  if (Array.isArray(userId)) {
    userId = userId[0];
  }

  if (!projectId) {
    return res.status(400).json({
      error: "Project Id needed",
    });
  }
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({
      error: "userId Id needed",
    });
  }

  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
  });

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  const project = await prisma.project.findUnique({
    where: {
      userId: user.id,
      id: projectId,
    },
    include: {
      messages: true,
    },
  });

  if (!project) {
    return res.status(404).json({
      message: "project not found",
    });
  }

  const sbx = await Sandbox.create("hmhu97yiefuboeu0an1l", { timeoutMs: 9_00_000 });
  const info = await sbx.getInfo();

  try {
    const containerName = "projects";
    const containerClient = blobServiceClient.getContainerClient(containerName);

    const prefix = `${projectId}/`;

    console.log("prefix : ", prefix);

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      // Remove the projectId prefix to get relative path
      const relativePath = blob.name.replace(prefix, "");

      // Download blob content
      const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
      const downloadResponse = await blockBlobClient.download();

      // Convert stream to string
      const downloaded = await streamToString(downloadResponse.readableStreamBody!);

      await sbx.files.write(relativePath, downloaded);
      console.log("writing : ", relativePath);
      console.log("for Sandbox : ", info.sandboxId);
    }

    const host = sbx.getHost(5173);
    const url = `https://${host}`;

    return res.json({
      message: "success",
      messages: project?.messages,
      projectId,
      url,
      sandboxId: info.sandboxId,
    });
  } catch (error: any) {
    console.error("Error reading files:", error);
    return res.status(500).json({
      error: "Failed to read files",
      details: error.message,
    });
  }
});

// Helper function to convert stream to string
async function streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on("data", (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    readableStream.on("error", reject);
  });
}

httpServer.listen(3001, () => {
  console.log("Server running on port 3001");
});
