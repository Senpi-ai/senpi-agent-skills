import type { Plugin } from "@moxie-protocol/core";
import { manageGroupsAction } from "./actions";

// Re-export utils for external use
export * from "./utils";

const moxieGroupsPlugin: Plugin = {
    name: "Moxie Groups Plugin",
    description: "Manage groups of Moxie users",
    actions: [manageGroupsAction],
    providers: [],
    evaluators: [],
    services: [],
    clients: [],
};

export default moxieGroupsPlugin;
