import {
  ActionGetResponse,
  ActionPostRequest,
  ActionPostResponse,
  ACTIONS_CORS_HEADERS,
  createPostResponse,
} from "@solana/actions";

import { Connection, PublicKey, Transaction } from "@solana/web3.js";

import {
  StaticTokenListResolutionStrategy,
  TokenInfo,
} from "@solana/spl-token-registry";

import VaultImpl from "@mercurial-finance/vault-sdk";
import { BN } from "bn.js";

export const GET = async (req: Request) => {
  const baseURL = new URL(req.url).origin;
  const pathActions = new URL(req.url).pathname;

  const payload: ActionGetResponse = {
    icon: new URL("/chainstack_square.png", baseURL).toString(),
    label: "Meteora",
    description: "Manage your SOL Vault liquidity",
    title: "Meteora Dynamic Vault Actions",
    links: {
      actions: [
        {
          label: "Deposit SOL",
          href: `${pathActions}?action=deposit&amount={amount}`,
          parameters: [
            {
              name: "amount",
              label: "Amount",
            },
          ],
        },
        {
          label: "Withdraw SOL",
          href: `${pathActions}?action=withdraw&amount={amount}`,
          parameters: [
            {
              name: "amount",
              label: "Amount",
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, {
    headers: ACTIONS_CORS_HEADERS,
  });
};

export const OPTIONS = GET;

export const POST = async (req: Request) => {
  try {
    const body: ActionPostRequest = await req.json();

    // Ensure the account parameter is valid
    let userAccount: PublicKey;

    try {
      userAccount = new PublicKey(body.account);
    } catch (err) {
      return Response.json(
        { message: "Invalid account provided" },
        {
          status: 400,
          headers: ACTIONS_CORS_HEADERS,
        },
      );
    }
    // Validate the action and amount parameters
    const { action, amount, errorMessage } = validateQueryParams(
      new URL(req.url),
    );
    if (errorMessage) {
      return Response.json(
        { message: errorMessage },
        {
          status: 400,
          headers: ACTIONS_CORS_HEADERS,
        },
      );
    }

    // Retrieve SOL token information
    const tokenMap = new StaticTokenListResolutionStrategy().resolve();
    const SOL_TOKEN_INFO = tokenMap.find(
      (token: { symbol: string }) => token.symbol === "SOL",
    ) as TokenInfo;

    // Get a Vault Implementation instance
    const connection = new Connection(process.env.CHAINSTACK_ENDPOINT);
    const vault: VaultImpl = await VaultImpl.create(connection, SOL_TOKEN_INFO);

    // Create a transaction based on the action
    let instruction!: Transaction;
    if (action === "deposit") {
      instruction = await vault.deposit(
        userAccount,
        new BN(amount * 10 ** SOL_TOKEN_INFO.decimals),
      );
    } else if (action === "withdraw") {
      instruction = await vault.withdraw(
        userAccount,
        new BN(amount * 10 ** SOL_TOKEN_INFO.decimals),
      );
    }

    const transaction = new Transaction();
    transaction.add(instruction);

    transaction.feePayer = userAccount;
    // It's not required, a client will replace it with the latest blockhash
    // However, Phantom wallet doesn't send a transaction without a blockhash
    transaction.recentBlockhash = (
      await connection.getLatestBlockhash({ commitment: "finalized" })
    ).blockhash;

    // Create a POST response
    const payload: ActionPostResponse = await createPostResponse({
      fields: {
        transaction: transaction,
        message:
          action == "deposit"
            ? `Deposit ${amount} SOL`
            : `Withdraw ${amount} SOL`,
      },
    });

    return Response.json(payload, {
      headers: ACTIONS_CORS_HEADERS,
    });
  } catch (err) {
    return Response.json(
      { message: "Unknown error occurred" },
      {
        status: 500,
        headers: ACTIONS_CORS_HEADERS,
      },
    );
  }
};

function validateQueryParams(requestURL: URL): {
  action: string;
  amount: number;
  errorMessage?: string;
} {
  // Validate the action and amount parameters
  const action = requestURL.searchParams.get("action");
  const amountParam = requestURL.searchParams.get("amount");

  // Ensure the action and amount parameters are present
  if (!action || !amountParam) {
    return {
      action: "",
      amount: 0,
      errorMessage: "Missing action or amount parameter",
    };
  }

  // Ensure the action parameter is valid
  if (action !== "deposit" && action !== "withdraw") {
    return {
      action: "",
      amount: 0,
      errorMessage: "Invalid action parameter",
    };
  }

  // Ensure the amount parameter is valid
  const amount = parseFloat(amountParam);

  if (isNaN(amount) || amount <= 0) {
    return {
      action: "",
      amount: 0,
      errorMessage: `Invalid amount for ${action}`,
    };
  }

  return {
    action,
    amount,
  };
}
