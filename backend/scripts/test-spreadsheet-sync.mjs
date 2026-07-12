import { readFileSync } from "fs";
import { parseCsvToRows, syncMapsFromSpreadsheet } from "../src/services/spreadsheetSync.js";
import { prisma } from "../src/lib/prisma.js";

const csv = readFileSync(new URL("./sample-field-ops.csv", import.meta.url), "utf8");
console.log("parsed rows:", parseCsvToRows(csv).length);

const u = await prisma.user.findFirst({
  where: { email: "ops@ops-demo.local" },
  include: { roles: true },
});
if (!u) throw new Error("ops user missing");

const user = {
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  roles: u.roles.map((r) => r.role),
};

const res = await syncMapsFromSpreadsheet(user, { csv });
console.log(res);
await prisma.$disconnect();
