import { ActionExample } from "@moxie-protocol/core";

export const senpiOrdersExamples: ActionExample[][] = [
    [
        {
            user: "{{user1}}",
            content: {
                text: "buy me 1 $[DEGEN|0x4ed4e862860bed51a9570b96d89af5e1b0efefed]]",
            },
        },
        {
            user: "{{agent}}",
            content: {
                text: "Sure, I'll help you to buy 1 $[DEGEN|0x4ed4e862860bed51a9570b96d89af5e1b0efefed]]",
                action: "SENPI_ORDERS",
            },
        },
    ],
    [
        {
            user: "{{user1}}",
            content: {
                text: "swap 1 $[DEGEN|0x4ed4e862860bed51a9570b96d89af5e1b0efefed]]",
            },
        },
        {
            user: "{{agent}}",
            content: {
                text: "Sure, I'll help you to swap 1 $[DEGEN|0x4ed4e862860bed51a9570b96d89af5e1b0efefed]]",
                action: "SENPI_ORDERS",
            },
        },
    ],

    [
        {
            user: "{{user1}}",
            content: {
                text: "sell all my $[DEGEN|0x4ed4e862860bed51a9570b96d89af5e1b0efefed]]",
            },
        },
        {
            user: "{{agent}}",
            content: {
                text: "Sure, I'll help you to sell all your $[DEGEN|0x4ed4e862860bed51a9570b96d89af5e1b0efefed]]",
                action: "SENPI_ORDERS",
            },
        },
    ],

];
