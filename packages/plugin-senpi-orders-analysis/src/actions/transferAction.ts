import {
    type Action,
    type IAgentRuntime,
    type Memory,
    type HandlerCallback,
    type State,
    elizaLogger,
    type ActionExample,
    composeContext,
    generateObject,
    ModelClass,
} from "@moxie-protocol/core";
import { MoxieWalletClient } from "@moxie-protocol/moxie-agent-lib/src/wallet";
import { transferEthTemplate } from "../templates";
import { TransferEthSchema } from "../types";

import { ethers } from "ethers";

async function resolveENS(ensName: string): Promise<string | null> {
    try {
        const provider = new ethers.JsonRpcProvider(
            `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
        );
        const address = await provider.resolveName(ensName);
        if (address) {
            return address;
        } else {
            console.log(`No address found for ${ensName}`);
            return null;
        }
    } catch (error) {
        console.error("Error resolving ENS:", error);
        return null;
    }
}

export const transferAction: Action = {
    name: "TRANSFER_BASE_ETH",
    similes: [
        "TRANSFER_ETH_ON_BASE",
        "TRANSFER_NATIVE_ETH_ON_BASE",
        "TRANSFER_BASE_TOKEN",
    ],
    description: "Transfer ETH token on Base from one wallet to another",
    suppressInitialMessage: true,
    validate: async () => true,
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback: HandlerCallback
    ) => {
        try {
            elizaLogger.log("Starting TRANSFER_BASE_ETH handler...");

            // Initialize or update state
            if (!state) {
                state = (await runtime.composeState(message)) as State;
            } else {
                state = await runtime.updateRecentMessageState(state);
            }

            const context = composeContext({
                state,
                template: transferEthTemplate,
            });

            const transferDetails = await generateObject({
                runtime,
                context,
                modelClass: ModelClass.SMALL,
                schema: TransferEthSchema,
            });
            let {
                toAddress,
                amount: value,
                isENS,
            } = transferDetails.object as {
                toAddress: string;
                amount: number;
                isENS: boolean;
            };

            if (isENS) {
                toAddress = await resolveENS(toAddress);
                if (!toAddress) {
                    callback({ text: "Invalid ENS name" });
                    return true;
                }
            }
            // Validate amount is defined and greater than 0
            if (!value || value <= 0) {
                callback({ text: "Transfer amount must be greater than 0" });
                return true;
            }

            const formattedValue = value * 1e18;
            // Validate ethereum address format
            const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
            if (!ethAddressRegex.test(toAddress)) {
                callback({ text: "Invalid Ethereum address format" });
                return true;
            }

            elizaLogger.log(
                `Transfering ${formattedValue} wei to address ${toAddress}...`
            );
            const wallet = state.moxieWalletClient as MoxieWalletClient;

            const { hash } = await wallet.sendTransaction("8543", {
                toAddress,
                value: formattedValue,
            });

            elizaLogger.success(
                `Transfer completed successfully! Transaction hash: ${hash}`
            );
            await callback?.(
                {
                    text: `Transfer completed successfully! Transaction hash: ${hash}`,
                },
                []
            );
            return true;
        } catch (error) {
            elizaLogger.error("Error transfering Base ETH:", error);
            callback({
                text: "Failed to transfer Base ETH. Please check the logs.",
            });
        }
    },
    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Send 0.01 ETH to 0x114B242D931B47D5cDcEe7AF065856f70ee278C4",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Transfer completed successfully! Transaction hash: 0xdde850f9257365fffffc11324726ebdcf5b90b01c6eec9b3e7ab3e81fde6f14b",
                    action: "TRANSFER_BASE_ETH",
                },
            },
        ],
    ] as ActionExample[][],
};
