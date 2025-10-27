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
    },
    maxRetries: 0,
    messages,
  });

  const host = sbx.getHost(5173);

  const url = `https://${host}`;
  console.log("url : ", url);

  const resp = response.content;

  res.json({
    messages: [
      ...messages,
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

  await CreateTreeFile(sbx);

  const execution = await sbx.commands.run("node /tmp/getTree.js");
  // console.log("execution.stdout : ", execution.stdout);
  const result = JSON.parse(execution.stdout);
  // console.log("result : ", result);
  return res.json({ message: "success", files: result.files, tree: result.tree });
});
app.listen(3000);
