import * as yaml from "https://deno.land/std@0.70.0/encoding/yaml.ts";
import * as path from "https://deno.land/std@0.70.0/path/mod.ts";

type DriverMetadata = {
  'platform': string;
};
function isDriverMetadata(data: any): data is DriverMetadata {
  return "platform" in data;
}

export type FunctionDef = {
	'name':          string
	'input-shape':   string
	'output-shape':  string
	'context-shape': string // effectively 'this'
	'source':        string
}
function isFunctionDef(data: any): data is FunctionDef {
  return "input-shape" in data || "output-shape" in data || "context-shape" in data;
}

export type ShapeDef = {
	'name':         string
	'type':         string
	'props':        Array<PropDef>
	'native-props': Array<PropDef>
}
function isShapeDef(data: any): data is ShapeDef {
  return "type" in data && "props" in data && data.props.every(isPropDef);
}

export type PropDef = {
	'name':     string
	'type':     string
	'optional': boolean | null
	'reactive': boolean | null
	'target':   string // name of driver resource to point to
}
function isPropDef(data: any): data is PropDef {
  return "name" in data && "type" in data;
}

export class NativeDriver {
  name: string
  #decoder: TextDecoder = new TextDecoder("utf-8")
  constructor(name: string) {
    this.name = name;
  }

  async readTextFile(...names: Array<string>): Promise<string> {
    const filePath = path.join(this.name, ...names);
    const data = await Deno.readFile(filePath);
    return this.#decoder.decode(data);
  }

  async readMetadata(): Promise<DriverMetadata | null> {
    const metadata = yaml.parse(await this.readTextFile("metadata.yaml"));
    if (metadata && isDriverMetadata(metadata)) return metadata;
    return null;
  }

  async *readShapes(): AsyncIterable<ShapeDef> {
    const shapeDir = path.join(this.name, "shapes");
    for await (const dirEntry of Deno.readDir(shapeDir)) {
      const name = path.basename(dirEntry.name, '.yaml');
      if (name === dirEntry.name) continue;

      const shapeDef = await this.readShape(name);
      if (shapeDef) yield shapeDef;
    }
  }
  async readShape(name: string): Promise<ShapeDef | null> {
    const data = yaml.parse(await this.readTextFile("shapes", `${name}.yaml`));
    if (data && isShapeDef(data)) {
      data.name = name;
      data["native-props"] = data["native-props"] || [];
      return data;
    }
    return null;
  }

  async *readFunctions(sourceExt: string): AsyncIterable<FunctionDef> {
    const funcDir = path.join(this.name, "functions");
    for await (const dirEntry of Deno.readDir(funcDir)) {
      const name = path.basename(dirEntry.name, '.yaml');
      if (name === dirEntry.name) continue;

      const funcDef = await this.readFunction(name, sourceExt);
      if (funcDef) yield funcDef;
    }
  }
  async readFunction(name: string, sourceExt: string): Promise<FunctionDef | null> {
    const data = yaml.parse(await this.readTextFile("functions", `${name}.yaml`));
    if (data && isFunctionDef(data)) {
      data.name = name;
      data.source = await this.readTextFile("functions", `${name}${sourceExt}`);
      return data;
    }
    return null;
  }
}
