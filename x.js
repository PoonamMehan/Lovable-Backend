import { Sandbox } from "@e2b/code-interpreter";

const sbx = await Sandbox.connect("itt4acd16a1gqhcu81wlw", {
  apiKey: "e2b_7bf1e9aef187048c19bb768a85c8d76903331a43",
});

sbx.commands.run("npm install", { cwd: "/home/user" });
