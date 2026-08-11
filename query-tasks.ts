import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client";

async function main() {
  const adapter = new PrismaPg({ connectionString: "postgresql://rtm_admin:rtm_secret_2026@127.0.0.1:5432/rtm_db" });
  const client = new PrismaClient({ adapter });
  try {
    const tasks = await client.task.findMany({
      where: {
        updatedAt: {
          gte: new Date("2026-07-26T18:30:00.000Z"),
          lte: new Date()
        }
      },
      orderBy: { updatedAt: "desc" }
    });
    console.log("=== TASKS WITH updatedAt IN TODAY (IST) RANGE ===");
    console.log("IST range start (UTC): 2026-07-26T18:30:00.000Z");
    console.log("Now (UTC): " + new Date().toISOString());
    console.log("Total tasks: " + tasks.length);
    console.log("");
    for (const t of tasks) {
      console.log(JSON.stringify({
        id: t.id,
        type: t.type,
        status: t.status,
        cancelledReason: t.cancelledReason,
        assignedUserId: t.assignedUserId,
        assignedUserName: t.assignedUserName,
        channelName: t.channelName,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString()
      }));
    }
    console.log("");
    console.log("=== END ===");
  } finally { await client.$disconnect(); }
}
main().catch(e => { console.error(e); process.exit(1); });
