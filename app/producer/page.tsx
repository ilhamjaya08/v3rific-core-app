"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { parseAbiItem, type BaseError } from "viem";
import { FaArrowLeft } from "react-icons/fa";

import { ConnectSection } from "./components/ConnectSection";
import { FeatureHighlights } from "./components/FeatureHighlights";
import { GuideSteps } from "./components/GuideSteps";
import { RegisterForm, type RegisterFormValues } from "./components/RegisterForm";
import {
  ProducerDashboard,
  type ProducerProfile,
  type ProductSummary,
} from "./components/ProducerDashboard";
import { producerRegistryAbi } from "@/lib/abi/producerRegistry";
import { v3rificAbi } from "@/lib/abi/v3rific";
import { resolveIpfsUrl } from "@/lib/utils/ipfs";

const registryAddress = (process.env.NEXT_PUBLIC_PRODUCER_REGISTRY_CONTRACT ??
  "0xa9ac835cF754793e9af5c9F3CE7c126b2aa165b6") as `0x${string}`;

const v3rificAddress = (process.env.NEXT_PUBLIC_V3RIFIC_CONTRACT ??
  "0x7eF608a4860fCc507FE7D5aa457769278ADE31fb") as `0x${string}`;

const productMintedEvent = parseAbiItem(
  "event ProductMinted(uint256 indexed tokenId, string cid, string unitshash, address indexed producer, bool verified, bool claimEnabled)"
);

type FeedbackState =
  | { type: "success"; message: string }
  | { type: "error"; message: string }
  | { type: "pending"; message: string }
  | null;

type RegistryProducer = {
  name: string;
  description: string;
  website: string;
  contact: string;
  country: string;
  registered: boolean;
  verified: boolean;
  registeredAt: bigint;
  admin: `0x${string}`;
};

type ProductFetchState =
  | { status: "idle"; data: ProductSummary[] }
  | { status: "loading"; data: ProductSummary[] }
  | { status: "ready"; data: ProductSummary[] }
  | { status: "error"; data: ProductSummary[]; message: string };

export default function ProducerPage() {
  const { isConnected, address } = useAccount();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [resetSignal, setResetSignal] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [productsState, setProductsState] = useState<ProductFetchState>({ status: "idle", data: [] });

  useEffect(() => {
    setProductsState({ status: "idle", data: [] });
  }, [address]);

  useEffect(() => {
    setIsHydrated(true);
  }, []);

  const isConnectionReady = isHydrated && isConnected;

  const producerArgs = useMemo(
    () => (isConnectionReady && address ? ([address] as [`0x${string}`]) : undefined),
    [address, isConnectionReady]
  );

  const {
    data: rawProducer,
    isPending: isFetchingProducer,
    error: producerError,
    refetch: refetchProducer,
  } = useReadContract({
    address: registryAddress,
    abi: producerRegistryAbi,
    functionName: "getProducer",
    args: producerArgs,
    chainId: sepolia.id,
    query: {
      enabled: Boolean(isConnectionReady && address),
      refetchOnWindowFocus: false,
    },
  });

  const {
    isLoading: isConfirming,
    isSuccess: isConfirmed,
    error: confirmationError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: sepolia.id,
    query: {
      enabled: Boolean(txHash),
    },
  });

  const producerProfile = useMemo<ProducerProfile | null>(() => {
    const producer = rawProducer as RegistryProducer | undefined;
    if (!producer || !producer.registered) {
      return null;
    }

    return {
      name: producer.name,
      description: producer.description,
      website: producer.website,
      contact: producer.contact,
      country: producer.country,
      registered: producer.registered,
      verified: producer.verified,
      registeredAt: producer.registeredAt.toString(),
      admin: producer.admin,
    };
  }, [rawProducer]);

  useEffect(() => {
    if (isConfirming) {
      setFeedback({ type: "pending", message: "Transaction submitted. Awaiting confirmations..." });
    }
  }, [isConfirming]);

  useEffect(() => {
    if (isConfirmed) {
      setFeedback({ type: "success", message: "Producer registration confirmed on-chain." });
      setTxHash(undefined);
      setResetSignal((count) => count + 1);
      refetchProducer();
    }
  }, [isConfirmed, refetchProducer]);

  useEffect(() => {
    if (confirmationError) {
      setFeedback({
        type: "error",
        message: parseError(confirmationError),
      });
      setTxHash(undefined);
    }
  }, [confirmationError]);

  useEffect(() => {
    if (producerProfile) {
      setFeedback(null);
    }
  }, [producerProfile]);

  const refreshProducts = useCallback(
    async (isCancelled?: () => boolean) => {
      if (!producerProfile || !address || !publicClient) {
        return;
      }

      setProductsState((prev) => ({ status: "loading", data: prev.data }));

      try {
        const fromBlock = getDeployBlock();
        const logs = await publicClient.getLogs({
          address: v3rificAddress,
          event: productMintedEvent,
          args: { producer: address },
          fromBlock,
          toBlock: "latest",
        });

        if (logs.length === 0) {
          if (!isCancelled?.()) {
            setProductsState({ status: "ready", data: [] });
          }
          return;
        }

        const entries = await Promise.all(
          logs.map(async (log) => {
            const unitshash = (log.args.unitshash as string).toLowerCase();
            const tokenId = (log.args.tokenId as bigint).toString();
            const verified = Boolean(log.args.verified);

            const product = (await publicClient.readContract({
              address: v3rificAddress,
              abi: v3rificAbi,
              functionName: "getByUnitshash",
              args: [unitshash],
            })) as ContractProduct;

            const metadata = await fetchMetadataSafe(product.cid);
            const mintedAtMs = Number(product.mintedAt) ? Number(product.mintedAt) * 1000 : 0;
            const mintedAtIso = mintedAtMs ? new Date(mintedAtMs).toISOString() : new Date(0).toISOString();

            const name = typeof metadata.name === "string" && metadata.name.trim() ? metadata.name : `Token ${tokenId}`;
            const sku = typeof metadata.sku === "string" && metadata.sku.trim() ? metadata.sku : "N/A";
            const batch = typeof metadata.batch === "string" && metadata.batch.trim() ? metadata.batch : "N/A";

            const status = product.revoked
              ? "Revoked"
              : verified
              ? "Verified"
              : "Minted";

            return {
              id: tokenId,
              name,
              sku,
              batch,
              status,
              mintedAt: mintedAtIso,
              unitshash,
            } satisfies ProductSummary;
          })
        );

        const deduped = new Map<string, ProductSummary>();
        for (const item of entries) {
          deduped.set(item.unitshash, item);
        }

        const items = Array.from(deduped.values());
        items.sort((a, b) => new Date(b.mintedAt).getTime() - new Date(a.mintedAt).getTime());

        if (!isCancelled?.()) {
          setProductsState({ status: "ready", data: items });
        }
      } catch (error) {
        if (!isCancelled?.()) {
          setProductsState((prev) => ({
            status: "error",
            data: prev.data,
            message: parseError(error),
          }));
        }
      }
    },
    [producerProfile, address, publicClient]
  );

  useEffect(() => {
    let cancelled = false;
    if (!producerProfile || !address || !publicClient) {
      return;
    }

    void refreshProducts(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [producerProfile, address, publicClient, refreshProducts]);

  const handleRegister = async (values: RegisterFormValues) => {
    if (!registryAddress) {
      setFeedback({
        type: "error",
        message: "Producer registry contract address is not configured.",
      });
      return false;
    }

    if (!address) {
      setFeedback({
        type: "error",
        message: "Connect your wallet before registering.",
      });
      return false;
    }

    try {
      setFeedback({ type: "pending", message: "Waiting for wallet signature..." });
      const hash = await writeContractAsync({
        address: registryAddress,
        abi: producerRegistryAbi,
        functionName: "registerProducer",
        chainId: sepolia.id,
        args: [values.name, values.description, values.website, values.contact, values.country],
      });
      setTxHash(hash);
      return false;
    } catch (error) {
      setFeedback({
        type: "error",
        message: parseError(error),
      });
      return false;
    }
  };

  const isRegistering = isWriting || isConfirming;

  const renderContent = () => {
    if (!isConnectionReady) {
      return <ConnectSection />;
    }

    if (isFetchingProducer) {
      return <LoadingState />;
    }

    if (producerError) {
      return <ErrorState message={parseError(producerError)} onRetry={() => void refetchProducer()} />;
    }

    if (!producerProfile) {
      return (
        <div className="grid gap-8 lg:grid-cols-[3fr,2fr]">
          <RegisterForm
            onRegister={handleRegister}
            isSubmitting={isRegistering}
            feedback={feedback}
            resetSignal={resetSignal}
          />
          <div className="space-y-6">
            <WalletStatus address={address} />
            <FeatureHighlights />
            <GuideSteps />
          </div>
        </div>
      );
    }

    const isLoadingProducts = productsState.status === "loading" || productsState.status === "idle";
    const productsError = productsState.status === "error" ? productsState.message : null;

    return (
      <ProducerDashboard
        profile={producerProfile}
        products={productsState.data}
        isLoading={isLoadingProducts}
        errorMessage={productsError}
        onRetry={productsError ? () => void refreshProducts() : undefined}
        onRefresh={() => void refreshProducts()}
      />
    );
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <header className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-400 font-extrabold text-slate-900 shadow-lg">
            V3
          </div>
          <div>
            <h1 className="text-xl font-semibold">Producer Studio</h1>
            <p className="text-sm text-slate-300">Register your brand and monitor manufacturer status in one place.</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 transition hover:bg-white/5"
          >
            <FaArrowLeft className="text-xs" />
            Back to overview
          </Link>
          <ConnectButton chainStatus="icon" accountStatus="address" showBalance={false} />
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-6 pb-16">{renderContent()}</section>
    </main>
  );
}

type ContractProduct = {
  tokenId: bigint;
  cid: string;
  unitshash: string;
  producer: `0x${string}`;
  claimEnabled: boolean;
  revoked: boolean;
  mintedAt: bigint;
};

function LoadingState() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-sm text-slate-300">
      Fetching producer profile from the registry...
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-4 rounded-3xl border border-rose-400/40 bg-rose-500/10 p-10 text-sm text-rose-100">
      <div>{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center justify-center rounded-lg border border-white/20 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
      >
        Retry
      </button>
    </div>
  );
}

function WalletStatus({ address }: { address?: `0x${string}` }) {
  if (!address) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-6 shadow-lg">
      <h3 className="text-lg font-semibold text-slate-100">Wallet status</h3>
      <p className="mt-2 text-sm text-slate-300">
        Connected wallet:{" "}
        <span className="font-mono text-indigo-300">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
      </p>
      <p className="mt-4 text-sm text-slate-300">
        Complete the registration form to activate your producer dashboard. Once the smart contract integration is live, the verification state will be updated automatically.
      </p>
    </div>
  );
}

function getDeployBlock(): bigint {
  const value = process.env.NEXT_PUBLIC_V3RIFIC_DEPLOY_BLOCK;
  if (!value) {
    return BigInt(0);
  }

  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}

async function fetchMetadataSafe(cid: string): Promise<Record<string, unknown>> {
  if (!cid) {
    return {};
  }

  try {
    const url = resolveIpfsUrl(cid);
    if (!url) {
      return {};
    }

    const response = await fetch(url);
    if (!response.ok) {
      return {};
    }

    const json = (await response.json()) as Record<string, unknown>;
    return json ?? {};
  } catch {
    return {};
  }
}

function parseError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (isBaseError(error)) {
    return error.shortMessage ?? error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error occurred.";
}

function isBaseError(error: unknown): error is BaseError {
  return typeof error === "object" && error !== null && "shortMessage" in error;
}
