import { sprintf } from "https://deno.land/std@0.70.0/fmt/printf.ts";
import * as path from "https://deno.land/std@0.70.0/path/mod.ts";

import type { NativeDriver, ShapeDef, FunctionDef } from "./driver.ts";
import {
  snakeToCamel,
  snakeToCamelLower,
  commonInitialisms,
} from "./snaker.ts";

export async function build(
  source: NativeDriver,
  target: string,
  compile: boolean,
  cleanup: boolean,
) {
  // load all the driver resources
  const driver = new GoDriver(source);
  await driver.load();

  // set up an empty go module
  const tempDir = await TempDir.createTempDir();
  await tempDir.runGo(["mod", "init", `stardust-driver.local/${source.name}`]);

  await driver.generate(tempDir);

  if (compile) {
    await driver.compile(tempDir, path.resolve(target));
  }
  if (cleanup) {
    await tempDir.delete();
  }
}

class TempDir {
  path: string;
  #encoder: TextEncoder = new TextEncoder();
  constructor(path: string) {
    this.path = path;
  }

  static async createTempDir() {
    const p = Deno.run({
      cmd: ["mktemp", "-d"],
      stdout: "piped",
    });
    const { code } = await p.status();
    if (code !== 0) {
      throw new Error(`Failed to allocate temp dir: code ${code}`);
    }
    const rawOutput = await p.output();
    const path = new TextDecoder("utf-8").decode(rawOutput).trim();
    console.log("Created tempdir at", path);
    return new TempDir(path);
  }

  async writeTextFile(names: Array<string>, data: string) {
    const filePath = path.join(this.path, ...names);
    await Deno.writeFile(filePath, this.#encoder.encode(data));
    console.log("Wrote file", names.join("/"));
  }

  async runGo(args: Array<string>) {
    const p = Deno.run({
      cmd: ["go", ...args],
      cwd: this.path,
    });
    const { code } = await p.status();
    if (code !== 0) throw new Error(`Failed to run go: code ${code}`);
  }

  async delete() {
    const p = Deno.run({
      cmd: ["rm", "-r", this.path],
    });
    const { code } = await p.status();
    if (code !== 0) throw new Error(`Failed to rm tempdir: code ${code}`);
  }
}

class GoWriter {
  depsAvail: Map<string, string>;
  depsUsed: Set<string>;
  parts: Array<string>;

  constructor(depsAvail: Map<string, string>) {
    this.depsAvail = depsAvail;
    this.depsUsed = new Set();
    this.parts = new Array();
  }

  useDep(key: string) {
    if (!this.depsAvail.has(key)) {
      throw new Error(
        `Tried using undeclared dep '${key}'`,
      );
    }
    this.depsUsed.add(key);
  }

  write(format: string, ...args: unknown[]) {
    this.parts.push(sprintf(format, ...args));
  }
  writeSeparator(format: string, ...args: unknown[]) {
    this.write("//////////////////////////////////\n// ");
    this.write(format + "\n\n", ...args);
  }

  stringify(): string {
    const final = [
      "package main\n\n",
      ...(this.depsUsed.size > 0
        ? [
          "import (\n",
          // only imports that were used
          ...Array.from(this.depsUsed).map((depKey) =>
            sprintf("  %s %s\n", depKey, this.depsAvail.get(depKey))
          ),
          ")\n\n",
        ]
        : []),
      ...this.parts,
    ];
    return final.join("");
  }
}

class GoDriver {
  source: NativeDriver;
  deps: Map<string, string>;
  shapeNames: Map<string, ShapeDef>;
  funcNames: Map<string, FunctionDef>;
  builtinShapes: Set<string>;

  constructor(source: NativeDriver) {
    this.source = source;
    this.deps = new Map();
    this.shapeNames = new Map();
    this.funcNames = new Map();
    this.builtinShapes = new Set();

    // Offer stardust essentials by default
    this.deps.set("base", '"github.com/stardustapp/dustgo/lib/base"');
    this.deps.set("inmem", '"github.com/stardustapp/dustgo/lib/inmem"');
    // this.deps.set("stardust", '"github.com/stardustapp/dustgo/lib/client"');
    this.deps.set("skylink", '"github.com/stardustapp/dustgo/lib/skylink"');
    this.deps.set("toolbox", '"github.com/stardustapp/dustgo/lib/toolbox"');

    this.builtinShapes.add("String");
    this.builtinShapes.add("Channel");
    this.builtinShapes.add("File");
    this.builtinShapes.add("Folder");
    this.builtinShapes.add("Function");
  }

  async load() {
    const deps = await this.source.readTextFile("deps.txt");
    // log.Println("No dependency file found in driver")
    for (const line of deps.trim().split("\n")) {
      if (!line.startsWith("golang ")) continue;
      const parts = line.split(" ");
      this.deps.set(parts[1], parts[2]);
    }

    for await (const shape of this.source.readShapes()) {
      this.shapeNames.set(shape.name, shape);
    }
    for await (const func of this.source.readFunctions(".go")) {
      this.funcNames.set(func.name, func);
    }
  }

  async generate(tempDir: TempDir) {
    console.log("Generating code...");

    const shapeWriter = new GoWriter(this.deps);

    // first write a folder with all the shapes listed
    shapeWriter.writeSeparator("Shape collection");
    shapeWriter.write(
      'var AllShapes *inmem.Folder = inmem.NewFolderOf("shapes",\n',
    );
    for (const name of this.shapeNames.keys()) {
      shapeWriter.write("  %sShape,\n", snakeToCamelLower(name));
    }
    shapeWriter.write(")\n\n");

    // now write out the shapes themselves
    for (const shape of this.shapeNames.values()) {
      shapeWriter.writeSeparator("Shape: %s\n\n", shape.name);

      shapeWriter.useDep("inmem");
      shapeWriter.write(
        "var %sShape *inmem.Shape = inmem.NewShape(\n",
        snakeToCamelLower(shape.name),
      );
      shapeWriter.write('  inmem.NewFolderOf("%s",\n', shape.name);
      shapeWriter.write('    inmem.NewString("type", "%s"),\n', shape.type);

      switch (shape.type) {
        case "Folder":
          shapeWriter.write('    inmem.NewFolderOf("props",\n');
          for (const prop of shape.props) {
            shapeWriter.write('      inmem.NewFolderOf("%s",\n', prop.name);
            shapeWriter.write(
              '        inmem.NewString("type", "%s"),\n',
              prop.type,
            );

            // functions have tasty type info
            if (prop.type === "Function") {
              const funct = this.funcNames.get(prop.target);
              if (!funct) {
                throw new Error(
                  `Failed to resolve Function ${prop.target} for prop ${prop.name}`,
                );
              }

              if (funct["input-shape"]) {
                shapeWriter.useDep("inmem");
                if (this.builtinShapes.has(funct["input-shape"])) {
                  shapeWriter.write(
                    '        inmem.NewShape(inmem.NewFolderOf("input-shape",\n',
                  );
                  shapeWriter.write(
                    '          inmem.NewString("type", "%s"),\n',
                    funct["input-shape"],
                  );
                  shapeWriter.write("        )),\n");
                } else {
                  shapeWriter.write(
                    '        inmem.NewShape(inmem.NewFolderFrom("input-shape", %sShape)),\n',
                    snakeToCamelLower(funct["input-shape"]),
                  );
                }
              }

              if (funct["output-shape"]) {
                shapeWriter.useDep("inmem");
                if (this.builtinShapes.has(funct["output-shape"])) {
                  shapeWriter.write(
                    '        inmem.NewShape(inmem.NewFolderOf("output-shape",\n',
                  );
                  shapeWriter.write(
                    '          inmem.NewString("type", "%s"),\n',
                    funct["output-shape"],
                  );
                  shapeWriter.write("        )),\n");
                } else {
                  shapeWriter.write(
                    '        inmem.NewShape(inmem.NewFolderFrom("output-shape", %sShape)),\n',
                    snakeToCamelLower(funct["output-shape"]),
                  );
                }
              }
            } else {
              if (prop.optional != null) {
                const optionalStr = prop.optional ? "yes" : "no";
                shapeWriter.write(
                  '        inmem.NewString("optional", "%s"),\n',
                  optionalStr,
                );
              }
            }

            shapeWriter.write("      ),\n");
          }
          shapeWriter.write("    ),\n");
      }
      shapeWriter.write("  ))\n\n");
    }
    await tempDir.writeTextFile(["shapes.go"], shapeWriter.stringify());

    const folderWriter = new GoWriter(this.deps);
    for (const shape of this.shapeNames.values()) {
      if (shape.type !== "Folder") { // TODO
        console.log(
          "WARN: Shape",
          shape.name,
          " is not a Folder, not supported yet",
        );
        continue;
      }

      folderWriter.writeSeparator("Folder for shape: %s\n\n", shape.name);
      const properName = snakeToCamel(shape.name);

      // Write out the basic struct w/ fields
      folderWriter.write("type %s struct {\n", properName);
      for (const prop of shape.props) {
        if (prop.type === "Function") {
          continue; // functions are exposed virtually
        } else if (prop.type === "String") {
          if (prop.reactive) {
            folderWriter.write(
              "  %s *toolbox.ReactiveString\n",
              snakeToCamel(prop.name),
            );
            folderWriter.useDep("toolbox");
          } else {
            // let's put raw strings in
            folderWriter.write("  %s string\n", snakeToCamel(prop.name));
          }
        } else if (this.shapeNames.has(prop.type)) {
          folderWriter.write(
            "  %s *%s\n",
            snakeToCamel(prop.name),
            snakeToCamel(prop.type),
          );
        } else {
          folderWriter.write(
            "  %s base.%s\n",
            snakeToCamel(prop.name),
            prop.type,
          );
          folderWriter.useDep("base");
        }
      }
      for (const prop of shape["native-props"]) {
        folderWriter.write(
          "  %s %s\n",
          snakeToCamelLower(prop.name),
          prop.type,
        );
        if (prop.type.includes(".")) {
          folderWriter.useDep(prop.type.split(".")[0].replace(/^\*+/, ""));
        }
      }
      folderWriter.write("}\n\n");

      // Start the struct to be a Folder
      folderWriter.useDep("base");
      folderWriter.write("var _ base.Folder = (*%s)(nil)\n\n", properName);
      folderWriter.write("func (e *%s) Name() string {\n", properName);
      folderWriter.write('  return "%s"\n}\n\n', shape.name);

      // List the children
      folderWriter.write("func (e *%s) Children() []string {\n", properName);
      folderWriter.write("  return []string{\n");
      for (const prop of shape.props) {
        folderWriter.write('    "%s",\n', prop.name);
      }
      folderWriter.write("  }\n}\n\n");

      // Enable child fetching
      folderWriter.write(
        "func (e *%s) Fetch(name string) (entry base.Entry, ok bool) {\n",
        properName,
      );
      folderWriter.write("  switch name {\n\n");
      for (const prop of shape.props) {
        folderWriter.write('  case "%s":\n', prop.name);

        // functions are exposed directly
        if (prop.type === "Function") {
          folderWriter.write("    return &%sFunc{", snakeToCamel(prop.target));
          const funct = this.funcNames.get(prop.target);
          if (funct && funct["context-shape"]) {
            folderWriter.write("e");
          }
          folderWriter.write("}, true\n\n");
        } else if (prop.type === "String" && !prop.reactive) {
          folderWriter.useDep("inmem");
          folderWriter.write(
            '    return inmem.NewString("%s", e.%s), true\n\n',
            prop.name,
            snakeToCamel(prop.name),
          );
        } else {
          folderWriter.write(
            "    return e.%s, true\n\n",
            snakeToCamel(prop.name),
          );
        }
      }
      folderWriter.write("  default:\n    return\n  }\n}\n\n");

      // TODO: this doesn't enable put!
      folderWriter.write(
        "func (e *%s) Put(name string, entry base.Entry) (ok bool) {\n",
        properName,
      );
      folderWriter.write("  return false\n}\n\n");

      // Check if there are fields to pull off a givenfolder
      const needsFolder = shape.props.some((x) => x.type !== "Function");

      // Upconvert basic entries into a typed shape
      // TODO: Only works with folders so far
      // Dual-returns with an okay status - checks for required fields and such
      folderWriter.write(
        "func inflate%s(input base.Entry) (out *%s, ok bool) {\n",
        properName,
        properName,
      );
      if (needsFolder) {
        folderWriter.write("  folder, ok := input.(base.Folder)\n");
        folderWriter.write("  if !ok {\n    return nil, false\n  }\n\n");
      }

      folderWriter.write("  x := &%s{}\n\n", properName);
      for (const prop of shape.props) {
        if (prop.type === "Function") {
          continue; // functions are not assigned to instances
        }
        folderWriter.write(
          '  if ent, ok := folder.Fetch("%s"); ok {\n',
          prop.name,
        );

        if (prop.type == "String") {
          if (prop.reactive) {
            folderWriter.useDep("toolbox");
            folderWriter.useDep("base");
            folderWriter.write(
              '    x.%s = toolbox.NewReactiveString("%s", "")\n',
              snakeToCamel(prop.name),
              prop.name,
            );
            folderWriter.write(
              "    if stringEnt, ok := ent.(base.String); ok {\n",
            );
            folderWriter.write(
              "      x.%s.Set(stringEnt.Get())\n",
              snakeToCamel(prop.name),
            );
            folderWriter.write("    }\n");
          } else {
            folderWriter.useDep("base");
            folderWriter.write(
              "    if stringEnt, ok := ent.(base.String); ok {\n",
            );
            folderWriter.write(
              "      x.%s = stringEnt.Get()\n",
              snakeToCamel(prop.name),
            );
            folderWriter.write("    }\n");
          }
        } else if (this.shapeNames.has(prop.type)) {
          folderWriter.write(
            "    if native, ok := inflate%s(ent); ok {\n",
            snakeToCamel(prop.type),
          );
          folderWriter.write("      x.%s = native\n", snakeToCamel(prop.name));
          folderWriter.write("    }\n");
        } else {
          folderWriter.write(
            "    if ent, ok := ent.(base.%s); ok {\n",
            prop.type,
          );
          folderWriter.write("      x.%s = ent\n", snakeToCamel(prop.name));
          folderWriter.write("    }\n");
          folderWriter.useDep("base");
        }

        folderWriter.write("  }\n\n");
      }
      folderWriter.write("  return x, true\n");
      folderWriter.write("}\n\n");
    }
    await tempDir.writeTextFile(["folders.go"], folderWriter.stringify());

    const funcWriter = new GoWriter(this.deps);
    for (const funct of this.funcNames.values()) {
      funcWriter.writeSeparator("Function: %s\n\n", funct.name);

      // first let's write out the impl
      const implWriter = new GoWriter(this.deps);
      implWriter.write("%s", funct.source);
      const implFileName = sprintf("func-%s.go", funct.name);
      await tempDir.writeTextFile([implFileName], implWriter.stringify());

      const properName = snakeToCamel(funct.name) + "Func";

      // Write out a primitive Function impl
      // TODO: make one static instance of this?
      funcWriter.useDep("base");
      funcWriter.write("type %sInner struct {", properName);
      if (funct["context-shape"]) {
        funcWriter.write("\n  ctx *%s\n", snakeToCamel(funct["context-shape"]));
      }
      funcWriter.write("}\n\n");

      funcWriter.write("var _ base.Function = (*%sInner)(nil)\n\n", properName);
      funcWriter.write("func (e *%sInner) Name() string {\n", properName);
      funcWriter.write('  return "invoke"\n}\n\n');
      funcWriter.write(
        "func (e *%sInner) Invoke(ctx base.Context, input base.Entry) base.Entry {\n",
        properName,
      );

      // Do some input mapping
      if (this.builtinShapes.has(funct["input-shape"])) {
        funcWriter.write(
          "  in%s, ok := input.(base.%s)\n",
          funct["input-shape"],
          funct["input-shape"],
        );
        funcWriter.write("  if !ok {\n    return nil\n  }\n\n");

        if (funct["input-shape"] === "String") {
          funcWriter.write("  realInput := in%s.Get()\n", funct["input-shape"]);
        } else {
          funcWriter.write("  realInput := in%s\n", funct["input-shape"]);
        }
      } else if (funct["input-shape"]) {
        funcWriter.write(
          "  realInput, ok := inflate%s(input)\n",
          snakeToCamel(funct["input-shape"]),
        );
        funcWriter.write("  if !ok {\n    return nil\n  }\n\n");
      }

      // This call syntax changes based on presence of all three shapes
      funcWriter.write("  ");
      if (funct["output-shape"]) {
        funcWriter.write("result := ");
      }
      if (funct["context-shape"]) {
        funcWriter.write("e.ctx.");
      }
      funcWriter.write("%sImpl(", snakeToCamel(funct.name));
      if (funct["input-shape"]) {
        funcWriter.write("realInput");
      }
      funcWriter.write(")\n");

      // Map output too if needed
      if (!funct["output-shape"]) {
        funcWriter.write("  return nil\n");
      } else if (funct["output-shape"] === "String") {
        funcWriter.useDep("inmem");
        funcWriter.write(
          '  return inmem.NewString("%s-output", result)\n',
          funct.name,
        );
      } else {
        funcWriter.write("  return result\n");
      }
      funcWriter.write("}\n\n");

      // gotta gen a folder impl for every function
      // TODO: if no context, make one static instance of this
      funcWriter.write("type %s struct {", properName);
      if (funct["context-shape"]) {
        funcWriter.write("\n  ctx *%s\n", snakeToCamel(funct["context-shape"]));
      }
      funcWriter.write("}\n\n");

      // Start the struct to be a Folder
      // We want to fit the "Function" shape in core
      funcWriter.useDep("base");
      funcWriter.write("var _ base.Folder = (*%s)(nil)\n\n", properName);
      funcWriter.write("func (e *%s) Name() string {\n", properName);
      funcWriter.write('  return "%s"\n}\n\n', funct.name);

      // List the children
      funcWriter.write("func (e *%s) Children() []string {\n", properName);
      funcWriter.write("  return []string{\n");
      funcWriter.write('    "invoke",\n');
      if (funct["input-shape"]) {
        funcWriter.write('    "input-shape",\n');
      }
      if (funct["output-shape"]) {
        funcWriter.write('    "output-shape",\n');
      }
      funcWriter.write("  }\n}\n\n");

      // Enable child fetching
      funcWriter.write(
        "func (e *%s) Fetch(name string) (entry base.Entry, ok bool) {\n",
        properName,
      );
      funcWriter.write("  switch name {\n\n");

      funcWriter.write('  case "invoke":\n');
      funcWriter.write("    return &%sInner{", properName);
      if (funct["context-shape"]) {
        funcWriter.write("e.ctx");
      }
      funcWriter.write("}, true\n");

      if (funct["context-shape"]) {
        funcWriter.write('  case "context-shape":\n');
        funcWriter.write(
          "    return %sShape, true\n",
          snakeToCamelLower(funct["context-shape"]),
        );
      }
      if (funct["input-shape"]) {
        funcWriter.write('  case "input-shape":\n');
        if (this.builtinShapes.has(funct["input-shape"])) {
          funcWriter.useDep("inmem");
          funcWriter.write(
            '    return inmem.NewShape(inmem.NewFolderOf("input-shape",\n',
          );
          funcWriter.write(
            '      inmem.NewString("type", "%s"),\n',
            funct["input-shape"],
          );
          funcWriter.write("    )), true\n");
        } else {
          funcWriter.write(
            "    return %sShape, true\n",
            snakeToCamelLower(funct["input-shape"]),
          );
        }
      }
      if (funct["output-shape"]) {
        funcWriter.write('  case "output-shape":\n');
        if (this.builtinShapes.has(funct["output-shape"])) {
          funcWriter.useDep("inmem");
          funcWriter.write(
            '    return inmem.NewShape(inmem.NewFolderOf("output-shape",\n',
          );
          funcWriter.write(
            '      inmem.NewString("type", "%s"),\n',
            funct["output-shape"],
          );
          funcWriter.write("    )), true\n");
        } else {
          funcWriter.write(
            "    return %sShape, true\n",
            snakeToCamelLower(funct["output-shape"]),
          );
        }
      }

      funcWriter.write("  default:\n    return\n  }\n}\n\n");

      // don't allow writing
      funcWriter.write(
        "func (e *%s) Put(name string, entry base.Entry) (ok bool) {\n",
        properName,
      );
      funcWriter.write("  return false\n}\n\n");
    }
    await tempDir.writeTextFile(["functions.go"], funcWriter.stringify());

    // Create a single main()
    const mainWriter = new GoWriter(this.deps);
    mainWriter.useDep("skylink");
    mainWriter.useDep("inmem");
    mainWriter.useDep("base");
    mainWriter.write(`
      import "log"
      import "fmt"
      import "net/http"

      func main() {
        root := inmem.NewFolderOf("/",
          inmem.NewFolder("n"),
          inmem.NewFolder("tmp"),
          inmem.NewFolderOf("drivers",
            skylink.GetNsexportDriver(),
          ),
        )

        ns := base.NewNamespace("/", root)
        ctx := base.NewRootContext(ns)

        ctx.Put("/srv", &Root{})

        log.Println("Starting nsexport...")
        exportFunc, _ := ctx.GetFunction("/drivers/nsexport/invoke")
        exportBase, _ := ctx.Get("/srv")
        exportFunc.Invoke(ctx, exportBase)

        host := fmt.Sprint("0.0.0.0:", 9234)
        log.Printf("Listening on %%s...", host)
        if err := http.ListenAndServe(host, nil); err != nil {
          log.Println("ListenAndServe:", err)
        }
      }
    `.replace(/^      /g, ''));
    await tempDir.writeTextFile(["main.go"], mainWriter.stringify());
  }

  async compile(tempDir: TempDir, targetPath: string) {
    console.log("Fetching deps...");
    await tempDir.runGo(["get", "-d"]);

    console.log("Compiling...");
    await tempDir.runGo(["build", "-o", targetPath]);
  }
}
