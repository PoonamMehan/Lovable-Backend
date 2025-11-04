import { tool } from "ai";
import { z } from "zod";

export const updateFile = (sbx: any, emit: any) => {
  return tool({
    description: "Update a file at a certain directory",
    inputSchema: z.object({
      location: z.string().describe("Relative path to the file with filename and extension"),
      content: z.string().describe("Content of the file"),
    }),
    execute: async ({ location, content }: { location: string; content: string }) => {
      await sbx.files.write(location, content);
      emit("tool:updateFile", { name: "updateFile", location });
      return `File updated`;
    },
  });
};
export const runCommand = (sbx: any, emit: any) => {
  return tool({
    description: "Run a command in terminal",
    inputSchema: z.object({
      command: z.string().describe("Command to run in the terminal"),
    }),
    execute: async ({ command }: { command: string }) => {
      console.log("Tool called : ", { command });

      const result = await sbx.commands.run(command, {
        cwd: "/home/user",
      });

      emit("tool:runCommand", { name: "runCommand", command });

      if (result.error) {
        console.log("runCommand error: ", result);
        return `Command failed with error`;
      }
      console.log("runCommand result: ", result);
      return `Command executed successfully:\nSTDOUT: ${result.stdout}`;
    },
  });
};

export const readFile = (sbx: any) => {
  return {
    description: "Read a file at a certain directory",
    inputSchema: z.object({
      location: z.string().describe("Relative path to the file"),
    }),
    execute: async ({ location }: { location: string }) => {
      const fileContent = await sbx.files.read(location);

      return fileContent;
    },
  };
};
