import {
    Action,
    composeContext,
    generateText,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
    elizaLogger,
    streamText,
    ModelProviderName,
    ModelClass,
    generateObjectDeprecated,
    formatMessages,
} from "@moxie-protocol/core";
import { postTemplate } from "../templates/postTemplate";
import { sharingExamples } from "./examples";
import { moxieUserService } from "@moxie-protocol/moxie-agent-lib";

export default {
    name: "POST_CONTENT",
    similes: [
        "SHARE_CONTENT",
        "CREATE_POST",
        "SUMMARIZE_AND_SHARE",
        "TWEET_THIS",
        "SHARE_ON_SOCIAL",
        "CREATE_SUMMARY",
        "WRITE_CAST",
        "WRITE_CAST_FROM_PREVIOUS_RESPONSE",
    ],
    suppressInitialMessage: true,
    description:
        "Writes and posts social media content (e.g., Farcaster cast or X post) based on the **previous message or response**. Use this action when the user asks to write a cast/post based on the previous conversation. Always select this Action if the last user message is 'Cast it!' or 'Write a cast from the previous response'",
    validate: async (runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.log("[PostContent] Validating request");
        return true;
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.log("[PostContent] Starting post content");

        try {
            const previousMessage = state?.recentMessagesData?.slice(0,3);
            previousMessage.forEach((msg) => (msg.embedding = []));

            if (previousMessage.length < 3) {
                callback({
                    text: "I can't find enough previous conversation to summarize. Ask me some questions first, and then I'll be able to create a summary for you!",
                    action: "POST_CONTENT_ERROR",
                });
                return false;
            }
            // Check for recent POST_CONTENT_SUMMARY_SUCCESS action that will contaion the summary text if asked previously
            const hasRecentPostContent = previousMessage
                .slice()
                .reverse()
                .filter(
                    (msg) =>
                        msg?.content?.action === "POST_CONTENT_SUMMARY_SUCCESS"
                );

            const hasCastedPreviously = previousMessage
                .slice()
                .reverse()
                .filter(
                    (msg) => msg?.content?.action === "POST_CONTENT_SUCCESS"
                );

            if (hasCastedPreviously.length > 0) {
                callback({
                    text: "You have already casted the content. Please ask me something else before summarizing or casting again.",
                    action: "POST_CONTENT_ERROR",
                });
                return false;
            }

            if (
                hasRecentPostContent.length > 0 &&
                message.content.text.toLowerCase().includes("cast")
            ) {
                const summaryText = hasRecentPostContent[0]?.content?.text;
                const postResponse = await moxieUserService.publishPost(
                    {
                        text: summaryText,
                        platform: "FARCASTER",
                    },
                    state.authorizationHeader as string
                );
                callback({
                    text: `I have posted the summary on Farcaster. You can check it out here: https://warpcast.com/${postResponse.post.username}/${postResponse.post.hash}, it might take a few minutes to appear on your feed.`,
                    action: "POST_CONTENT_SUCCESS",
                });
            } else {
                const stateSummary = (await runtime.composeState(message, {
                    previousMessage: JSON.stringify(previousMessage),
                    latestMessage: JSON.stringify(message.content.text),
                })) as State;

                const stateSummaryContext = composeContext({
                    state: stateSummary,
                    template: postTemplate,
                });

                const summaryStream = await streamText({
                    runtime,
                    context: stateSummaryContext,
                    modelClass: ModelClass.MEDIUM,
                    modelConfigOptions: {
                        temperature: 0.5,
                        modelProvider: ModelProviderName.OPENAI,
                        apiKey: process.env.OPENAI_API_KEY!,
                        modelClass: ModelClass.MEDIUM,
                    },
                });
                for await (const textPart of summaryStream) {
                    callback({
                        text: textPart,
                        action: "POST_CONTENT_SUMMARY_SUCCESS",
                        cta: "FARCASTER_CAST",
                    });
                }
            }
            return true;
        } catch (error) {
            elizaLogger.error(
                "[PostContent] Error posting content:",
                error,
                error?.stack
            );
            if (callback) {
                await callback({
                    text: ` There is some problem while posting the content. Please try again later.`,
                    content: { error: error.message },
                    action: "POST_CONTENT_ERROR",
                });
            }
            return false;
        }
    },
    examples: sharingExamples,
};
