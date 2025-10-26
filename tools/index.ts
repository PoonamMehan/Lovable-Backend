import { z } from "zod";

export const updateFile = (sbx: any) => {
  return {
    description: "Update a file at a certain directory",
    inputSchema: z.object({
      location: z.string().describe("Relative path to the file with filename and extension"),
      content: z.string().describe("Content of the file"),
    }),
    execute: async ({ location, content }: { location: string; content: string }) => {
      await sbx.files.write(location, content);
      return `File updated`;
    },
  };
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
