import bodyParser from "body-parser";
import cors from "cors";
import { type UUID, validateUuid } from "@moxie-protocol/core";
import {
    type AgentRuntime,
    composeContext,
    elizaLogger,
    generateMessageResponse,
    getEmbeddingZeroVector,
    getEnvVariable,
    type Memory,
    ModelClass,
} from "@moxie-protocol/core";
import { type MoxieClient, messageHandlerTemplate } from ".";
import { stringToUuid } from "@moxie-protocol/core";
import type { Content } from "@moxie-protocol/core";
import type { UserAgentInfo, UserAgentInteraction } from "./types/types.ts";
import {
    COMMON_AGENT_ID,
    mockMoxieUser,
    mockWallet,
    mockPortfolio,
} from "./constants/constants";
import { validateInputAgentInteractions } from "./helpers";
import express from "express";
import { ResponseHelper } from "./responseHelper.ts";
import { traceIdMiddleware } from "./middleware/traceId.ts";
import {
    ftaService,
    type Portfolio,
    getPortfolio,
} from "@moxie-protocol/moxie-agent-lib";
import { walletService, MoxieUser } from "@moxie-protocol/moxie-agent-lib";
import { MoxieWalletClient } from "@moxie-protocol/moxie-agent-lib/src/wallet";

import multer from "multer";
import * as fs from "node:fs";
import * as path from "node:path";

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(process.cwd(), "data", "uploads");
        // Create the directory if it doesn't exist
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    },
});

const upload = multer({ storage });

interface UUIDParams {
    agentId: UUID;
    roomId?: UUID;
}

function validateUUIDParams(
    params: { agentId: string; roomId?: string },
    res: express.Response
): UUIDParams | null {
    const agentId = validateUuid(params.agentId);
    if (!agentId) {
        res.status(400).json({
            error: "Invalid AgentId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        });
        return null;
    }

    if (params.roomId) {
        const roomId = validateUuid(params.roomId);
        if (!roomId) {
            res.status(400).json({
                error: "Invalid RoomId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            });
            return null;
        }
        return { agentId, roomId };
    }

    return { agentId };
}

const builtinActions = [
    "NONE",
    "IGNORE",
    "FOLLOW_ROOM",
    "CONTINUE",
    "MUTE_ROOM",
];
export function createMoxieApiRouter(
    agents: Map<string, AgentRuntime>,
    moxieClient: MoxieClient
) {
    const router = express.Router();

    router.use(cors());
    router.use(bodyParser.json());
    router.use(bodyParser.urlencoded({ extended: true }));
    router.use(
        express.json({
            limit: getEnvVariable("EXPRESS_MAX_PAYLOAD") || "100kb",
        })
    );
    router.use(traceIdMiddleware);

    router.get("/", async (req, res) => {
        res.send("Ok");
    });

    router.post(
        "/:agentId/message",
        upload.single("file"),
        async (req: express.Request, res: express.Response) => {
            const traceId = req.traceId;
            try {
                const startTime = new Date().getTime();
                elizaLogger.debug("/v1 message api is started", {
                    traceId: req.traceId,
                });
                elizaLogger.info("privyId extracted from token", {
                    traceId: req.traceId,
                });
                const agentId = req.params.agentId;
                let runtime = agents.get(agentId);
                elizaLogger.info(JSON.stringify(req.body), {
                    traceId: req.traceId,
                });

                // validations
                const { roomId, text } = req.body;

                if (!roomId || !validateUuid(roomId)) {
                    res.status(400).json(
                        ResponseHelper.error<UserAgentInfo>(
                            "MISSING_MANDATORY_INPUT",
                            "Invalid or missing `roomId`. Expected to be a valid UUID.",
                            req.path,
                            req.traceId
                        )
                    );
                    return;
                }

                if (!text || text.trim() === "") {
                    res.status(400).json(
                        ResponseHelper.error<UserAgentInfo>(
                            "MISSING_MANDATORY_INPUT",
                            "input field `text` is empty or missing",
                            req.path,
                            req.traceId
                        )
                    );
                    return;
                }

                elizaLogger.debug(
                    `checking if runtime exists for agentId: ${agentId}`,
                    { traceId: req.traceId }
                );
                // if runtime is null, look for runtime with the same name
                if (!runtime) {
                    runtime = Array.from(agents.values()).find(
                        (a: AgentRuntime) =>
                            a.character.name.toLowerCase() ===
                            agentId.toLowerCase()
                    );
                }

                if (!runtime) {
                    res.status(404).json(
                        ResponseHelper.error<UserAgentInfo>(
                            "AGENT_NOT_FOUND",
                            "Agent not found",
                            req.path,
                            req.traceId
                        )
                    );
                    return;
                }

                // Setting default mock values for states in local development
                const moxieUserInfo: MoxieUser = mockMoxieUser;
                const moxieUserId: string = moxieUserInfo.id;
                const agentWallet: walletService.MoxieClientWallet = mockWallet;
                let currentWalletBalance: Portfolio = mockPortfolio;

                // If Zapper API key is set, fetch the current balance of the agent wallet
                if (process.env.ZAPPER_API_KEY) {
                    // fetch the current balance of the agent wallet
                    currentWalletBalance = await getPortfolio(
                        [agentWallet.address],
                        [8453] // BASE_MAINNET
                    );
                    elizaLogger.info(traceId, `currentWalletBalance`, {
                        currentWalletBalance,
                    });
                }

                const userId = stringToUuid(moxieUserId);

                await runtime.ensureConnection(
                    userId,
                    roomId,
                    moxieUserInfo.userName,
                    moxieUserInfo.name,
                    "direct"
                );

                const messageId = stringToUuid(Date.now().toString());
                const content: Content = {
                    text,
                    source: "direct",
                    inReplyTo: req.body.inReplyTo ?? undefined,
                };

                const userMessage = {
                    content,
                    userId,
                    roomId,
                    agentId: runtime.agentId,
                };
                const userQuestionMessageId = stringToUuid(
                    messageId + "-" + userId
                );
                const memory: Memory = {
                    id: userQuestionMessageId,
                    ...userMessage,
                    agentId: runtime.agentId,
                    userId,
                    roomId,
                    content,
                    createdAt: Date.now(),
                };

                await runtime.messageManager.addEmbeddingToMemory(memory);
                await runtime.messageManager.createMemory(memory);

                const moxieWalletClient = new MoxieWalletClient(
                    agentWallet.address,
                    req.header("Authorization")
                );

                let state = await runtime.composeState(userMessage, {
                    agentName: runtime.character.name,
                    moxieUserInfo: moxieUserInfo,
                    agentWallet: agentWallet,
                    moxieWalletClient: moxieWalletClient,
                    agentWalletBalance: currentWalletBalance,
                    authorizationHeader: req.header("Authorization"),
                });

                const context = composeContext({
                    state,
                    template: messageHandlerTemplate,
                });

                const response = await generateMessageResponse({
                    runtime: runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });

                if (!response) {
                    res.status(500).json(
                        ResponseHelper.error<null>(
                            "INTERNAL_SERVER_ERROR",
                            "No response from generateMessageResponse",
                            req.path,
                            req.traceId
                        )
                    );
                    return;
                }

                // Set headers for chunked transfer encoding
                res.setHeader("Content-Type", "text/event-stream");
                res.setHeader("Transfer-Encoding", "chunked");
                res.setHeader("Connection", "keep-alive");
                res.setHeader("Cache-Control", "no-cache");
                res.flushHeaders(); // Ensure headers are sent immediately

                // save response to memory
                const responseMessage: Memory = {
                    id: stringToUuid(`${messageId}-${runtime.agentId}`),
                    ...userMessage,
                    userId: runtime.agentId,
                    content: response,
                    embedding: getEmbeddingZeroVector(),
                    createdAt: Date.now(),
                };

                // if the response contains action field and it's a builtin action, save the memory
                if (
                    !response.action ||
                    builtinActions?.includes(response.action)
                ) {
                    await runtime.messageManager.createMemory(responseMessage);
                    state = await runtime.updateRecentMessageState(state);
                }

                let message = null as Content | null;

                elizaLogger.debug(
                    `processing actions for agentId: ${agentId}`,
                    {
                        traceId: req.traceId,
                    }
                );

                let messageFromActions = false;
                let newContext = "";
                let newAction = undefined;
                const processingActionsStartTime = new Date().getTime();
                elizaLogger.debug(
                    req.traceId,
                    `processing action: ${response.action} started at ${processingActionsStartTime}`
                );
                await runtime.processActions(
                    memory,
                    [responseMessage],
                    state,
                    async (newMessages) => {
                        messageFromActions = true;
                        message = newMessages;
                        newAction = newMessages.action;
                        newContext += newMessages.text;
                        res.write(JSON.stringify(newMessages));
                        return [memory];
                    }
                );
                elizaLogger.debug(
                    req.traceId,
                    `processing action: ${response.action} ended at ${new Date().getTime()}. total time taken: ${new Date().getTime() - processingActionsStartTime} ms`
                );

                console.log("New Context", newContext);
                if (newContext != "") {
                    const newMessageId = stringToUuid(Date.now().toString());
                    const newContent: Content = {
                        text: newContext,
                        inReplyTo: userQuestionMessageId,
                        action: newAction,
                    };

                    const agentMessage = {
                        content: newContent,
                        userId: runtime.agentId,
                        roomId,
                        agentId: runtime.agentId,
                    };

                    const newMemory: Memory = {
                        id: stringToUuid(newMessageId + "-" + runtime.agentId),
                        ...agentMessage,
                        agentId: runtime.agentId,
                        userId: runtime.agentId,
                        roomId,
                        createdAt: Date.now(),
                    };

                    await runtime.messageManager.addEmbeddingToMemory(
                        newMemory
                    );
                    await runtime.messageManager.createMemory(newMemory);
                }

                await runtime.evaluate(memory, state);

                // Check if we should suppress the initial message
                const action = runtime.actions.find(
                    (a) => a.name === response.action
                );
                const shouldSuppressInitialMessage =
                    action?.suppressInitialMessage;

                if (!shouldSuppressInitialMessage) {
                    // write the response to the response stream
                    res.write(JSON.stringify(response));
                    if (message && !messageFromActions) {
                        res.write(JSON.stringify(message));
                    }
                } else {
                    // message from action is already written to the response stream
                    if (message && !messageFromActions) {
                        res.write(JSON.stringify(message));
                    }
                }
                elizaLogger.debug(
                    req.traceId,
                    `/v1 message api is ended with params: ${JSON.stringify(req.body)} and action: ${response.action} at ${new Date().getTime()}. total time taken: ${
                        new Date().getTime() - startTime
                    } ms`
                );
                res.end();
            } catch (error) {
                elizaLogger.error(error, { traceId: req.traceId });
                res.status(500).write(
                    JSON.stringify(
                        ResponseHelper.error<null>(
                            "INTERNAL_SERVER_ERROR",
                            `error from message api ${error.message}`,
                            req.path,
                            req.traceId
                        )
                    )
                );
                res.end();
                return;
            }
        }
    );

    router.get("/agent", async (req, res) => {
        elizaLogger.debug(
            `/agent endpoint is triggered with params: ${JSON.stringify(req.query)}`,
            { traceId: req.traceId }
        );
        try {
            // validate if useId request param exists, if not then return error
            const userId = req.query.userId as string;
            if (!userId) {
                res.status(400).json(
                    ResponseHelper.error<UserAgentInfo>(
                        "MISSING_MANDATORY_INPUT",
                        "missing userId input in request param",
                        req.path,
                        req.traceId
                    )
                );
                return;
            }
            // check if the userId has any interaction with the agent
            const userIdUUID = stringToUuid(userId);
            const account = await moxieClient.db.getAccountById(userIdUUID);

            // if account doesn't exist then return
            if (!account) {
                res.status(200).json(
                    ResponseHelper.success<UserAgentInfo>(
                        {
                            agentExists: false,
                            userId: userId,
                        },
                        req.traceId
                    )
                );
            } else {
                //await moxieClient.db.getAgent
                // set agentExists as true if account is present
                // for v1 version , we will just use one agent instance. hence we are going to maintain the env and return in response
                // for v2 release, we will create new agent runtime for every user and maintain separate agentIds.
                res.status(200).json(
                    ResponseHelper.success<UserAgentInfo>(
                        {
                            agentExists: true,
                            userId: userId,
                            agentId: COMMON_AGENT_ID,
                            //roomId: stringToUuid()
                        },
                        req.traceId
                    )
                );
            }
        } catch (error) {
            elizaLogger.error("Error fetching agent details:", error, {
                traceId: req.traceId,
            });
            res.status(500).json(
                ResponseHelper.error<UserAgentInfo>(
                    "INTERNAL_SERVER_ERROR",
                    `Failed to fetch user agent details: ${error}`,
                    req.path,
                    req.traceId
                )
            );
        }
    });

    router.get("/agents", (req, res) => {
        const agentsList = Array.from(agents.values()).map((agent) => ({
            id: agent.agentId,
            name: agent.character.name,
            clients: Object.keys(agent.clients),
        }));
        res.json({ agents: agentsList });
    });

    router.post("/agent", async (req, res) => {
        elizaLogger.debug(
            `POST /agent endpoint is triggered with params: ${req.body}`,
            { traceId: req.traceId }
        );
        try {
            // validations
            const moxieUserInfo = mockMoxieUser;
            const moxieUserId = moxieUserInfo.id;
            // check if the userId has  already agent created
            const userIdUUID = stringToUuid(moxieUserId);
            const account = await moxieClient.db.getAccountById(userIdUUID);
            if (account) {
                res.status(403).json(
                    ResponseHelper.error<null>(
                        "INVALID_REQUEST",
                        `user already has an agent`,
                        req.path,
                        req.traceId
                    )
                );
                return;
            }

            // check if the user has creator coin or not
            const ftaResponse = await ftaService.getUserFtaData(moxieUserId);
            if (!ftaResponse) {
                res.status(403).json(
                    ResponseHelper.error<null>(
                        "USER_NOT_ELIGIBILE",
                        `user must have creator coin to create an agent`,
                        req.path,
                        req.traceId
                    )
                );
                return;
            }

            // create an account for the user
            const accountCreationResponse = await moxieClient.db.createAccount({
                id: userIdUUID,
                name: `${moxieUserInfo.userName} AI Agent`,
                username: moxieUserInfo.name,
            });

            elizaLogger.info(
                `account is created for ${moxieUserId} agent} ${accountCreationResponse}`
            );
            res.status(201).json(
                ResponseHelper.success<UserAgentInfo>(
                    {
                        userId: moxieUserInfo.id,
                        agentId: COMMON_AGENT_ID,
                    },
                    req.traceId
                )
            );
            return;
        } catch (error) {
            elizaLogger.error("Error in create agent function:", error, {
                traceId: req.traceId,
            });
            res.status(500).json(
                ResponseHelper.error<null>(
                    "INTERNAL_SERVER_ERROR",
                    `Failed to create agent: ${error}`,
                    req.path,
                    req.traceId
                )
            );
            return;
        }
    });

    router.get("/agent/interactions", async (req, res) => {
        elizaLogger.debug("started /agent/interactions started", {
            traceId: req.traceId,
        });
        try {
            // input validations
            const errors = validateInputAgentInteractions(req.query);
            if (errors.length > 0) {
                res.status(400).json(
                    ResponseHelper.error<null>(
                        "MISSING_MANDATORY_INPUT",
                        errors
                            .map((e) => `${e.field}: ${e.message}`)
                            .join(", "),
                        req.path,
                        req.traceId
                    )
                );
                return;
            }

            // fetch the agent runtime
            const agentId = COMMON_AGENT_ID;
            let runtime = agents.get(agentId);

            const moxieUserInfo: MoxieUser = mockMoxieUser;
            const moxieUserId: string = moxieUserInfo.id;
            elizaLogger.debug(`moxieUserId ${moxieUserId}`, {
                traceId: req.traceId,
            });

            // if runtime is null, look for runtime with the same name
            if (!runtime) {
                runtime = Array.from(agents.values()).find(
                    (a: AgentRuntime) =>
                        a.character.name.toLowerCase() === agentId.toLowerCase()
                );
            }

            if (!runtime) {
                res.status(404).json(
                    ResponseHelper.error<null>(
                        "AGENT_NOT_FOUND",
                        "Agent not found",
                        req.path,
                        req.traceId
                    )
                );
                return;
            }

            // check if the userId has  already agent created
            const userIdUUID = stringToUuid(moxieUserInfo.id);
            const account =
                await runtime.databaseAdapter.getAccountById(userIdUUID);
            if (!account) {
                res.status(403).json(
                    ResponseHelper.error<null>(
                        "INVALID_REQUEST",
                        `user doesn't have agent`,
                        req.path,
                        req.traceId
                    )
                );
                return;
            }

            // Find all rooms where user and agent are participants
            const rooms = await runtime.databaseAdapter.getRoomsForParticipants(
                [userIdUUID]
            );

            // Check the existing memories in the database
            const currentRoomId = req.params.currentRoomId;
            const recentInteractions: Memory[] =
                await runtime.messageManager.getMemoriesByRoomIds({
                    // filter out the current room id from rooms
                    roomIds: rooms.filter((room) => room !== currentRoomId),
                    limit: Number(req.query.limit),
                });

            // Format the recent messages
            const firstInteractionGroupedByRoom = recentInteractions.reduce(
                (acc, message) => {
                    const isSelf = message.userId === runtime.agentId;

                    // Skip if this is a self message
                    if (isSelf) return acc;

                    const msg: UserAgentInteraction = {
                        text: message.content.text,
                        userId: message.userId,
                        roomId: message.roomId,
                        createdAt: message.createdAt,
                        agentId: message.agentId,
                    };

                    // If this is the first message for this room, or if it's earlier than the existing one
                    if (
                        !acc[message.roomId] ||
                        message.createdAt < acc[message.roomId].createdAt
                    ) {
                        acc[message.roomId] = msg;
                    }

                    return acc;
                },
                {} as Record<string, UserAgentInteraction>
            );

            // Extract only the values from groupedByRoom
            // Convert the values to JSON
            let groupedByRoomValuesJSON: UserAgentInteraction[];
            if (firstInteractionGroupedByRoom) {
                groupedByRoomValuesJSON = Object.values(
                    firstInteractionGroupedByRoom
                );
            }
            res.status(200).json(
                ResponseHelper.success<UserAgentInteraction[]>(
                    groupedByRoomValuesJSON,
                    req.traceId
                )
            );
        } catch (error) {
            elizaLogger.error("Error while fetching agent memories:", error, {
                traceId: req.traceId,
            });
            res.status(500).json(
                ResponseHelper.error<null>(
                    "INTERNAL_SERVER_ERROR",
                    `Error while fetching user interactions: ${error}`,
                    req.path,
                    req.traceId
                )
            );
            return;
        }
    });

    router.get("/agent/:agentId/:roomId/memories", async (req, res) => {
        elizaLogger.debug(
            `/agent/:agentId/:roomId/memories started with input:${req.params}`,
            { traceId: req.traceId }
        );
        const { agentId, roomId } = validateUUIDParams(
            {
                agentId: req.params.agentId,
                roomId: req.params.roomId,
            },
            res
        ) ?? {
            agentId: null,
            roomId: null,
        };

        if (!agentId || !roomId) {
            res.status(400).json(
                ResponseHelper.error<null>(
                    "MISSING_MANDATORY_INPUT",
                    `missing or invalid input for agentId / roomId`,
                    req.path,
                    req.traceId
                )
            );
            return;
        }

        let runtime = agents.get(agentId);

        // if runtime is null, look for runtime with the same name
        if (!runtime) {
            runtime = Array.from(agents.values()).find(
                (a) => a.character.name.toLowerCase() === agentId.toLowerCase()
            );
        }

        if (!runtime) {
            res.status(404).json(
                ResponseHelper.error<null>(
                    "AGENT_NOT_FOUND",
                    "Agent not found",
                    req.path,
                    req.traceId
                )
            );
            return;
        }

        try {
            const memories = await runtime.messageManager.getMemories({
                roomId,
                count: 100,
                unique: true,
            });
            const response = {
                agentId,
                roomId,
                memories: memories.map((memory) => ({
                    id: memory.id,
                    userId: memory.userId,
                    agentId: memory.agentId,
                    createdAt: memory.createdAt,
                    text: memory.content.text,
                    action: memory.content.action,
                    source: memory.content.source,
                    url: memory.content.url,
                    inReplyTo: memory.content.inReplyTo,
                    roomId: memory.roomId,
                })),
            };
            res.status(200).json(
                ResponseHelper.success<any>(response, req.traceId)
            );
        } catch (error) {
            elizaLogger.error("Error fetching memories:", error);
            res.status(500).json(
                ResponseHelper.error<null>(
                    "INTERNAL_SERVER_ERROR",
                    `Error while fetching memories from room: ${error}`,
                    req.path,
                    req.traceId
                )
            );
            return;
        }
    });

    return router;
}
