import { PrismaClient } from "@prisma/client";
import { seedDemoMaps } from "./demo-maps.js";

const prisma = new PrismaClient();

seedDemoMaps(prisma)
  .then(() => console.log("\nDemo maps reseed complete."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
