import * as flags from "https://deno.land/std@0.70.0/flags/mod.ts";
import * as yaml from "https://deno.land/std@0.70.0/encoding/yaml.ts";
import * as path from "https://deno.land/std@0.70.0/path/mod.ts";
// import { walk } from "https://deno.land/std@0.70.0/fs/mod.ts";

const args = flags.parse(Deno.args);
if (args._.length !== 1) {
  console.log('Specify a driver name to be built');
  Deno.exit(5);
}

type DriverMetadata = {
  'platform': string;
};
function isDriverMetadata(data: any): data is DriverMetadata {
  return "platform" in data;
}

type FunctionDef = {
	'name':          string
	'input-shape':   string
	'output-shape':  string
	'context-shape': string // effectively 'this'
	'source':        string
}
function isFunctionDef(data: any): data is FunctionDef {
  return "context-shape" in data;
}

type ShapeDef = {
	'name':         string
	'type':         string
	'props':        Array<PropDef>
	'native-props': Array<PropDef>
}
function isShapeDef(data: any): data is ShapeDef {
  return "type" in data;
}

type PropDef = {
	'name':     string
	'type':     string
	'optional': boolean | null
	'reactive': boolean | null
	'target':   string // name of driver resource to point to
}
function isPropDef(data: any): data is PropDef {
  return "name" in data && "type" in data;
}

class NativeDriver {
  #name: string
  #decoder: TextDecoder
  constructor(name: string) {
    this.#name = name;
    this.#decoder = new TextDecoder("utf-8");
  }

  async readTextFile(...names: Array<string>): Promise<string> {
    const filePath = path.join(this.#name, ...names);
    const data = await Deno.readFile(filePath);
    return this.#decoder.decode(data);
  }

  async readMetadata(): Promise<DriverMetadata | null> {
    const metadata = yaml.parse(await this.readTextFile("metadata.yaml"));
    if (metadata && isDriverMetadata(metadata)) return metadata;
    return null;
  }

  async *readShapes(): AsyncIterable<ShapeDef> {
    const shapeDir = path.join(this.#name, "shapes");
    for await (const dirEntry of Deno.readDir(shapeDir)) {
      const name = path.basename(dirEntry.name, '.yaml');
      const shapeDef = await this.readShape(name);
      if (shapeDef) yield shapeDef;
    }
  }

  async readShape(name: string): Promise<ShapeDef | null> {
    const data = yaml.parse(await this.readTextFile("shapes", `${name}.yaml`));
    if (data && isShapeDef(data)) return data;
    return null;
  }
}

(async function () {

  const driverName = `${args._[0]}`;
  console.log('Building', driverName, '...');
  const driver = new NativeDriver(driverName);

  const metadata = await driver.readMetadata();
  if (!metadata || !metadata.platform) throw new Error(
    `Driver at ${driverName} is lacking a platform`);
  switch (metadata.platform) {

    case 'golang':
      console.log('TODO: golang');
      for await (const shape of driver.readShapes()) {
        console.log(shape);
      }
      break;

    default:
      console.log('TODO: unknown driver platform', metadata.platform);
      return Deno.exit(6);
  }
})();
