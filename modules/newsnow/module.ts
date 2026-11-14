// The NewsNow module's addresses: the paths the api answers for it.
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "newsnow",
  apiPaths: [/^\/api\/site\/newsnow/],
});
