// What the crowding module adds to the site's pages: a way in, and a short reminder above every page.
import { Reminder } from "./web/Reminder.tsx";
import { CrowdingIcon } from "./web/Icon.tsx";

export default {
  name: "crowding",
  sidebar: { section: "更多", items: [{ to: "/crowding", label: "拥挤度", icon: CrowdingIcon }] },
  root: { Top: Reminder },
};
