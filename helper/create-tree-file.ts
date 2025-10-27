export const CreateTreeFile = async (sbx: any) => {
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
};
