import { sprintf } from 'https://deno.land/std@0.70.0/fmt/printf.ts';
import type { NativeDriver } from './index.ts';

export async function build(source: NativeDriver) {
  const driver = new GoDriver(source);
  await driver.load();
  await driver.generate();
  await driver.compile();
}

class GoWriter {
  depsAvail: Map<string,string>
  depsUsed: Set<string>
  parts: Array<string>

  constructor() {
    this.depsAvail = new Map;
    this.depsUsed = new Set;
    this.parts = new Array;
  }

  useDep(key: string) {
    if (!this.depsAvail.has(key)) throw new Error(
      `Tried using undeclared dep '${key}'`);
    this.depsUsed.add(key);
  }

  write(format: string, ...args: unknown[]) {
    this.parts.push(sprintf(format, ...args));
  }

  bytes(): Uint8Array {
    const final = [
      "package main\n\n",
      ...(this.depsUsed.size > 0 ? [
        "import (\n",
        // only imports that were used
        ...Array.from(this.depsUsed).map(depKey =>
          sprintf("  %s %s\n", depKey, this.depsAvail.get(depKey))),
        ")\n\n",
      ] : []),
      ...this.parts,
    ];
    return new TextEncoder().encode(final.join(''));
  }
}

class GoDriver {
  source: NativeDriver
  deps: Map<string,string>

  constructor(source: NativeDriver) {
    this.source = source;
    this.deps = new Map;

    // Offer stardust essentials by default
    this.deps.set("base", '"github.com/stardustapp/core/base"');
    this.deps.set("inmem", '"github.com/stardustapp/core/inmem"');
    this.deps.set("stardust", '"github.com/stardustapp/core/client"');
    this.deps.set("skylink", '"github.com/stardustapp/core/skylink"');
    this.deps.set("toolbox", '"github.com/stardustapp/core/toolbox"');
  }

  async load() {
    const deps = await this.source.readTextFile("deps.txt");
    // log.Println("No dependency file found in driver")
    for (const line of deps.trim().split('\n')) {
      if (!line.startsWith('golang ')) continue;
      const parts = line.split(' ');
      this.deps.set(parts[1], parts[2]);
    }

    // for await (const shape of driver.readShapes()) {
    //   console.log(shape);
    // }
    // for await (const shape of driver.readFunctions('.go')) {
    //   console.log(shape);
    // }
  }

  async generate() {

  }

  async compile() {

  }
}
