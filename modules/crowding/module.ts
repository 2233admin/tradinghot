// The crowding module's addresses: its page, and the paths the api answers for it.
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "crowding",
  pages: [{ path: "crowding", file: "web/page.tsx" }],
  apiPaths: [/^\/api\/site\/crowding/],
});
