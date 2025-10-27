import { Server } from "socket.io";
import { Sandbox } from "@e2b/code-interpreter";
import express from "express";
import dotenv from "dotenv";
import { generateText, streamText } from "ai";
import fs from "fs";
import path from "path";
import { google } from "@ai-sdk/google";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { updateFile, readFile } from "../tools/index.ts";
import cors from "cors";
import { CreateTreeFile } from "../helper/create-tree-file.ts";
import { createServer } from "http";

dotenv.config();

const app = express();
app.use(cors());
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

app.use(express.json());

io.on("connection", (socket) => {
  socket.on("startChat", async ({ prompt, messages, sandboxId, userId }) => {
    console.log("starting chat....");
    try {
      socket.join(userId);

      const sbx = sandboxId
        ? await Sandbox.connect(sandboxId)
        : await Sandbox.create("nav0r7gal5lnjfqhoe27", { timeoutMs: 9_00_000 });

      const info = await sbx.getInfo();

      const host = sbx.getHost(5173);

      const url = `https://${host}`;

      io.to(userId).emit("sandbox:connected", { sandboxId: sbx.sandboxId, url });

      const emit = (event: string, data: any) => io.to(userId).emit(event, data);

      const response = await generateText({
        model: google("gemini-2.5-pro"),
        system: SYSTEM_PROMPT,
        toolChoice: "required",
        tools: {
          updateFile: updateFile(sbx, emit),
        },
        messages,
        maxRetries: 0,
        onStepFinish: (step) => {
          emit("step:finish", { step });
        },
      });

      emit("ai:done", {
        url,
        response: response.content,
        sandboxId: info.sandboxId,
        messages: [...messages, { role: "assistant", content: JSON.stringify(response.content, null, 2) }],
      });
    } catch (err) {
      console.error("Error:", err);
      io.to(userId).emit("error", { message: err.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

app.post("/files", async (req, res) => {
  const { sandboxId } = req.body;

  if (!sandboxId) {
    return res.json({
      error: "Sandbox Id needed",
    });
  }

  const sbx = await Sandbox.connect(sandboxId, {
    timeoutMs: 9_00_000,
  });

  await CreateTreeFile(sbx);

  const execution = await sbx.commands.run("node /tmp/getTree.js");
  // console.log("execution.stdout : ", execution.stdout);
  const result = JSON.parse(execution.stdout);
  // console.log("result : ", result);
  return res.json({ message: "success", files: result.files, tree: result.tree });
});

httpServer.listen(3000, () => {
  console.log("Server running on port 3000");
});
