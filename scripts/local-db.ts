import "./load-env";

import {
  exportLocalWorkspace,
  localWorkspaceStatus,
  resetLocalWorkspace,
} from "../src/lib/data/local-store";

const [command = "status", destination = "gud-crm-local-export.json"] = process.argv.slice(2);

if (command === "reset") {
  const snapshot = resetLocalWorkspace();
  console.log(`SQLite workspace reset with ${snapshot.opportunities.length} opportunities.`);
} else if (command === "export") {
  console.log(`SQLite workspace exported to ${exportLocalWorkspace(destination)}.`);
} else {
  console.log(JSON.stringify(localWorkspaceStatus(), null, 2));
}
