// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import crowding from "@aihot/crowding/web";
import movers from "@aihot/movers/web";

export const WEB_MODULES: readonly WebModule[] = [crowding, movers];
