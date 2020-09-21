import * as flags from "https://deno.land/std@0.70.0/flags/mod.ts";

import { NativeDriver } from './driver.ts';
import * as golang from './platform_golang.ts';

const args = flags.parse(Deno.args);
if (args._.length !== 1) {
  console.log('Specify a driver name to be built');
  Deno.exit(5);
}

(async function () {

  const driver = new NativeDriver(`${args._[0]}`);
  console.log('Building driver', driver.name, '...');

  const metadata = await driver.readMetadata();
  if (!metadata || !metadata.platform) throw new Error(
    `Driver at ${driver.name} is lacking a platform`);
  switch (metadata.platform) {

    case 'golang':
      await golang.build(driver);
      break;

    default:
      console.log('TODO: unknown driver platform', metadata.platform);
      return Deno.exit(6);
  }
})();
