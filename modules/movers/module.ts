// The movers module's addresses: the paths the api answers for it.
import { defineModule } from "@aihot/contracts/modules";

export default defineModule({
  name: "movers",
  apiPaths: [/^\/api\/site\/movers/],
});
