// The NewsNow module: the upstream adapters, self-hosted.
//
// The worker reads the adapters through the local service and stores what the sources publish
// (bridge.ts); the api answers what the sources hold, with the time each source was really read.
// The service is a process of its own (service.ts), so the adapters run in one place and a slow
// site cannot hold the site's own answers up.
import { defineServerModule } from "@aihot/backend/modules";
import { readFeed } from "./client.ts";
import { collectNewsnow } from "./bridge.ts";
import { newsnowSources } from "./registry.ts";
import type { NewsnowFeedResponse } from "./types.ts";

export default defineServerModule({
  name: "newsnow",
  http: (app) => {
    app.get("/api/site/newsnow/sources", async (_request, reply) => {
      return reply.header("Cache-Control", "public, max-age=300").send({ sources: newsnowSources() });
    });
    app.get("/api/site/newsnow/feed", async (request, reply) => {
      const id = String((request.query as { id?: string }).id ?? "").trim();
      if (!id) {
        const empty: NewsnowFeedResponse = { id, status: "error", refreshedAt: null, items: [], error: "id is required" };
        return reply.code(400).send(empty);
      }
      try {
        return reply.send(await readFeed(id));
      } catch (error) {
        // The service is not answering: the reader is told the source could not be read, and no
        // time is given for a list that was never read.
        const failed: NewsnowFeedResponse = {
          id,
          status: "error",
          refreshedAt: null,
          items: [],
          error: error instanceof Error ? error.message : String(error),
        };
        return reply.send(failed);
      }
    });
  },
  schedules: [
    // The sources are read as often as they say they change; the schedule only wakes the worker up.
    { name: "newsnow.collect", cron: "* * * * *", missed: "once", when: () => process.env.COLLECT_ENABLED === "true", run: () => collectNewsnow() },
  ],
});
