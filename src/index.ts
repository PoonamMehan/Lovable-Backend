import { Sandbox } from "@e2b/code-interpreter";
import express from "express";
import dotenv from "dotenv";
import { generateText, streamText } from "ai";
import fs from "fs";
import path from "path";
import { google } from "@ai-sdk/google";
import { SYSTEM_PROMPT } from "./prompt.ts";
import { createFile, updateFile, readFile } from "../tools/index.ts";
import cors from "cors";
dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

type Item = {
  name: string;
  children?: string[];
};

app.post("/chat", async (req, res) => {
  let { prompt, messages, sandboxId } = req.body;

  if (!prompt) {
    return res.json({
      error: "No Prompt found ",
    });
  }

  let sbx: any;

  if (sandboxId) {
    sbx = await Sandbox.connect(sandboxId);
  } else {
    sbx = await Sandbox.create("nav0r7gal5lnjfqhoe27", {
      timeoutMs: 9_00_000,
    });
  }

  const info = await sbx.getInfo();

  const response = await generateText({
    model: google("gemini-2.5-pro"),
    system: SYSTEM_PROMPT,
    toolChoice: "required",
    tools: {
      updateFile: updateFile(sbx),
      readFile: readFile(sbx),
    },
    maxRetries: 0,
    messages: [
      ...messages,
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const host = sbx.getHost(5173);

  const url = `https://${host}`;
  console.log("url : ", url);

  const resp = response.content;

  res.json({
    messages: [
      ...messages,
      {
        role: "user",
        content: prompt,
      },
      {
        role: "assistant",
        content: JSON.stringify(resp, null, 2),
      },
    ],
    sandboxId: sbx.sandboxId,
    prompt,
    sandboxInfo: info,
    url,
    resp,
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

  await sbx.files.write(
    "/tmp/getTree.js",
    `
    const fs = require('fs');
    const path = require('path');

    const getFileAndTree = (projectDir) => {
      // console.log("Project Dir is : ", projectDir);
      // console.log("is this exists : " , fs.existsSync(projectDir))

      if (!fs.existsSync(projectDir)) {
        console.error(\`Base directory not found: \${projectDir}\`);
      }

      const files = [];

      const walk = (dir) => {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          if (
            ['node_modules', '.git', 'dist', 'build', '.bash_logout', '.bashrc', 'package-lock.json', ".npm", ".cache", "core"].includes(item)
          ) {
          continue
          };

          const fullPath = path.join(dir, item);
          // console.log("searching path : ", fullPath)
          if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
          } else {
            const content = fs.readFileSync(fullPath, 'utf8');
            // console.log("pushing to files : ", path.relative(projectDir, fullPath))
            files.push({
              path: path.relative(projectDir, fullPath),
              code: content,
            });
          }
        }

      };

      walk(projectDir);



      const tree = {};
      files.forEach(({ path: filePath }) => {
        const parts = filePath.split(path.sep);
        parts.forEach((part, index) => {
          const key = parts.slice(0, index + 1).join('/');
          if (!tree[key]) {
            tree[key] = { name: part };
          }
          if (index < parts.length - 1) {
            tree[key].children ||= [];
            const childKey = parts.slice(0, index + 2).join('/');
            if (!tree[key].children.includes(childKey)) {
              tree[key].children.push(childKey);
            }
          }
        });
      });

      // console.log("file are : ",files )
      // console.log("tree is : ",tree )

      return {
      files,
      tree
      }
    };

    // console.log("current path is : " , path.resolve("."))


    const projectDir = path.resolve(".")
    const result = getFileAndTree(projectDir)

    console.log(JSON.stringify(result));
    `,
  );

  const execution = await sbx.commands.run("node /tmp/getTree.js");
  // console.log("execution.stdout : ", execution.stdout);
  const result = JSON.parse(execution.stdout);
  // console.log("result : ", result);
  return res.json({ message: "success", files: result.files, tree: result.tree });
});
app.listen(3000);
