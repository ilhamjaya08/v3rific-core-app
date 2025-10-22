"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { sepolia } from "wagmi/chains";
import { formatEther, type BaseError } from "viem";
import * as XLSX from "xlsx";
import { FaArrowLeft, FaBolt, FaUpload, FaHive, FaList, FaShuffle } from "react-icons/fa6";
import { FaCheckCircle, FaExclamationTriangle, FaInfoCircle, FaTimesCircle } from "react-icons/fa";

import { producerRegistryAbi } from "@/lib/abi/producerRegistry";
import { v3rificAbi } from "@/lib/abi/v3rific";
import { createUnitshash } from "@/lib/utils/unitshash";

const registryAddress = (process.env.NEXT_PUBLIC_PRODUCER_REGISTRY_CONTRACT ??
  " ") as `0x${string}`;

const v3rificAddress = (process.env.NEXT_PUBLIC_V3RIFIC_CONTRACT ??
  "0xbe50a60c2207E7B3d094d7Fcc73EDD0068734e69") as `0x${string}`;

const INPUT_CLASS =
  "rounded-xl border border-white/15 bg-slate-900/60 px-4 py-3 text-base text-slate-100 outline-none transition focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/30";

type FeedbackState =
  | { type: "success" | "error" | "pending"; message: string }
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

type SingleFormValues = {
  name: string;
  description: string;
  sku: string;
  batch: string;
  collection: string;
  image: string;
  origin: string;
  externalUrl: string;
  additionalNotes: string;
};

type BulkRow = {
  name: string;
  description: string;
  sku: string;
  batch: string;
  collection?: string;
  image?: string;
  origin?: string;
  externalUrl?: string;
  additionalNotes?: string;
  unitshash?: string;
};

type BulkItemStatus =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "pinning" }
  | { state: "awaiting-signature" }
  | { state: "confirming"; hash: `0x${string}` }
  | { state: "success"; tokenId: string; unitshash: string }
  | { state: "error"; message: string };

const defaultSingleForm: SingleFormValues = {
  name: "",
  description: "",
  sku: "",
  batch: "",
  collection: "",
  image: "",
  origin: "",
  externalUrl: "",
  additionalNotes: "",
};
const PREVIEW_UNITSHASH = "preview00";

export default function MintPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: sepolia.id });
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [singleForm, setSingleForm] = useState<SingleFormValues>(() => ({ ...defaultSingleForm }));
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const [lastUnitshash, setLastUnitshash] = useState<string | null>(null);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkStatuses, setBulkStatuses] = useState<BulkItemStatus[]>([]);
  const [bulkInProgress, setBulkInProgress] = useState(false);

  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const {
    data: rawProducer,
    isPending: isFetchingProducer,
    error: producerError,
    refetch: refetchProducer,
  } = useReadContract({
    address: registryAddress,
    abi: producerRegistryAbi,
    functionName: "getProducer",
    args: isConnected && address ? ([address] as [`0x${string}`]) : undefined,
    chainId: sepolia.id,
    query: {
      enabled: Boolean(isConnected && address),
      refetchOnWindowFocus: false,
    },
  });

  const {
    data: platformFee,
    isPending: isFetchingFee,
    error: platformFeeError,
  } = useReadContract({
    address: v3rificAddress,
    abi: v3rificAbi,
    functionName: "platformFee",
    chainId: sepolia.id,
    query: {
      enabled: Boolean(isConnected && v3rificAddress),
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

  const producerProfile = useMemo(() => {
    const producer = rawProducer as RegistryProducer | undefined;
    if (!producer || !producer.registered) {
      return null;
    }

    return producer;
  }, [rawProducer]);

  const metadataPreview = useMemo(() => {
    if (!producerProfile || !address) {
      return null;
    }

    return buildMetadataPayload(
      singleForm,
      PREVIEW_UNITSHASH,
      {
        address,
        name: producerProfile.name,
        verified: producerProfile.verified,
      },
      { preview: true }
    );
  }, [address, producerProfile, singleForm]);

  const platformFeeValue = typeof platformFee === "bigint" ? platformFee : null;

  const singleFormDisabled = isWriting || isConfirming || !producerProfile || platformFeeValue === null;

  useEffect(() => {
    if (isConfirming) {
      setFeedback({ type: "pending", message: "Transaksi dikirim. Menunggu konfirmasi block..." });
    }
  }, [isConfirming]);

  useEffect(() => {
    if (!isConfirmed) {
      return;
    }

    let cancelled = false;

    const finalize = async () => {
      try {
        if (publicClient && lastUnitshash) {
          const product = (await publicClient.readContract({
            address: v3rificAddress,
            abi: v3rificAbi,
            functionName: "getByUnitshash",
            args: [lastUnitshash],
          })) as { tokenId: bigint };

          if (!cancelled) {
            setFeedback({
              type: "success",
              message: `Mint sukses. Token #${product?.tokenId ? product.tokenId.toString() : "pending"} dengan unitshash ${lastUnitshash}.`,
            });
          }
        } else if (!cancelled) {
          setFeedback({ type: "success", message: "Mint sukses dikonfirmasi." });
        }
      } catch (error) {
        if (!cancelled) {
          setFeedback({ type: "error", message: parseError(error) });
        }
      } finally {
        if (!cancelled) {
          setTxHash(undefined);
          setLastUnitshash(null);
          setSingleForm(() => ({ ...defaultSingleForm }));
        }
      }
    };

    void finalize();

    return () => {
      cancelled = true;
    };
  }, [isConfirmed, lastUnitshash, publicClient]);

  useEffect(() => {
    if (confirmationError) {
      setFeedback({ type: "error", message: parseError(confirmationError) });
      setTxHash(undefined);
    }
  }, [confirmationError]);

  const singleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!address) {
      setFeedback({ type: "error", message: "Connect wallet terlebih dahulu." });
      return;
    }

    if (!producerProfile) {
      setFeedback({ type: "error", message: "Anda belum terdaftar sebagai producer." });
      return;
    }

    if (platformFeeValue === null) {
      setFeedback({ type: "error", message: "Platform fee belum tersedia. Coba lagi." });
      return;
    }

    try {
      const unitshash = createUnitshash(8);
      setLastUnitshash(unitshash);
      setFeedback({ type: "pending", message: "Mengunggah metadata ke Pinata..." });

      const metadataPayload = buildMetadataPayload(singleForm, unitshash, {
        address,
        name: producerProfile.name,
        verified: producerProfile.verified,
      });

      const cid = await uploadMetadata(metadataPayload);

      setFeedback({ type: "pending", message: "Menunggu tanda tangan wallet untuk mintProduct..." });
      const hash = await writeContractAsync({
        address: v3rificAddress,
        abi: v3rificAbi,
        functionName: "mintProduct",
        args: [cid, unitshash, false],
        chainId: sepolia.id,
        value: platformFeeValue,
      });
      setTxHash(hash);
    } catch (error) {
      setFeedback({ type: "error", message: parseError(error) });
    }
  };

  const handleSingleInput =
    (field: keyof SingleFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setSingleForm((prev) => ({ ...prev, [field]: event.target.value as never }));
    };

  const handleBulkFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setBulkRows([]);
      setBulkStatuses([]);
      return;
    }

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const [firstSheet] = workbook.SheetNames;
      const sheet = workbook.Sheets[firstSheet];

      if (!sheet) {
        throw new Error("Sheet tidak ditemukan di file XLSX.");
      }

      const rows = XLSX.utils.sheet_to_json<BulkRow>(sheet, {
        defval: "",
        header: [
          "name",
          "description",
          "sku",
          "batch",
          "collection",
          "image",
          "origin",
          "externalUrl",
          "additionalNotes",
          "unitshash",
        ],
      }).filter((row) => row.name && row.sku && row.batch);

      const normalizedRows = rows.map((row) => ({
        ...row,
        name: String(row.name).trim(),
        description: row.description ? String(row.description).trim() : "",
        sku: String(row.sku).trim(),
        batch: String(row.batch).trim(),
        collection: row.collection ? String(row.collection).trim() : "",
        image: row.image ? String(row.image).trim() : "",
        origin: row.origin ? String(row.origin).trim() : "",
        externalUrl: row.externalUrl ? String(row.externalUrl).trim() : "",
        additionalNotes: row.additionalNotes ? String(row.additionalNotes).trim() : "",
        unitshash: row.unitshash ? String(row.unitshash).trim().toLowerCase() : "",
      }));

      if (normalizedRows.length === 0) {
        throw new Error("Tidak ada baris valid di template. Pastikan kolom name, sku, dan batch terisi.");
      }

      setBulkRows(normalizedRows);
      setBulkStatuses(normalizedRows.map(() => ({ state: "idle" })));
    } catch (error) {
      setFeedback({ type: "error", message: parseError(error) });
      setBulkRows([]);
      setBulkStatuses([]);
    } finally {
      event.target.value = "";
    }
  };

  const startBulkMint = async () => {
    if (!address || !producerProfile) {
      setFeedback({ type: "error", message: "Pastikan wallet terhubung dan producer sudah terdaftar." });
      return;
    }

    if (platformFeeValue === null) {
      setFeedback({ type: "error", message: "Platform fee belum tersedia. Coba lagi." });
      return;
    }

    if (!bulkRows.length) {
      setFeedback({ type: "error", message: "Tidak ada data yang siap di-mint." });
      return;
    }

    setBulkInProgress(true);
    setFeedback({ type: "pending", message: "Menjalankan mint secara berurutan. Anda akan diminta tanda tangan per item." });

    const statuses: BulkItemStatus[] = bulkRows.map(() => ({ state: "idle" }));
    setBulkStatuses([...statuses]);
    let hadError = false;

    for (let index = 0; index < bulkRows.length; index += 1) {
      const row = bulkRows[index];
      const unitshash = row.unitshash && row.unitshash.length >= 8 ? row.unitshash : createUnitshash(8);

      try {
        statuses[index] = { state: "uploading" };
        setBulkStatuses([...statuses]);

        const metadataPayload = buildMetadataPayload(
          {
            name: row.name,
            description: row.description ?? "",
            sku: row.sku,
            batch: row.batch,
            collection: row.collection ?? "",
            image: row.image ?? "",
            origin: row.origin ?? "",
            externalUrl: row.externalUrl ?? "",
            additionalNotes: row.additionalNotes ?? "",
          },
          unitshash,
          {
            address,
            name: producerProfile.name,
            verified: producerProfile.verified,
          }
        );

        const cid = await uploadMetadata(metadataPayload);

        statuses[index] = { state: "awaiting-signature" };
        setBulkStatuses([...statuses]);

        const hash = await writeContractAsync({
          address: v3rificAddress,
          abi: v3rificAbi,
          functionName: "mintProduct",
          args: [cid, unitshash, false],
          chainId: sepolia.id,
          value: platformFeeValue,
        });

        statuses[index] = { state: "confirming", hash };
        setBulkStatuses([...statuses]);

        if (!publicClient) {
          throw new Error("Public client tidak tersedia untuk menunggu konfirmasi.");
        }

        await publicClient.waitForTransactionReceipt({ hash });
        const product = (await publicClient.readContract({
          address: v3rificAddress,
          abi: v3rificAbi,
          functionName: "getByUnitshash",
          args: [unitshash],
        })) as { tokenId: bigint };

        statuses[index] = {
          state: "success",
          tokenId: product?.tokenId ? product.tokenId.toString() : "Pending indexing",
          unitshash,
        };
        setBulkStatuses([...statuses]);
      } catch (error) {
        statuses[index] = { state: "error", message: parseError(error) };
        setBulkStatuses([...statuses]);
        // Break to avoid piling confirmations if user cancels.
        hadError = true;
        break;
      }
    }

    setBulkInProgress(false);
    setFeedback(
      hadError
        ? { type: "error", message: "Proses bulk terhenti karena error. Silakan cek status tabel dan ulangi jika perlu." }
        : { type: "success", message: "Proses bulk selesai. Cek status tiap baris di tabel." }
    );
  };

  const resetSingleForm = () => {
    setSingleForm(() => ({ ...defaultSingleForm }));
    setFeedback(null);
    setTxHash(undefined);
    setLastUnitshash(null);
  };

  const platformFeeDisplay = useMemo(() => {
    if (platformFeeValue === null) return "0 ETH";
    try {
      return `${formatEther(platformFeeValue)} ETH`;
    } catch {
      return `${platformFeeValue.toString()} wei`;
    }
  }, [platformFeeValue]);

  if (!isConnected) {
    return (
      <MintLayout>
        <DisconnectedState />
      </MintLayout>
    );
  }

  if (isFetchingProducer || isFetchingFee) {
    return (
      <MintLayout>
        <LoadingState />
      </MintLayout>
    );
  }

  if (producerError) {
    return (
      <MintLayout>
        <ErrorState message={parseError(producerError)} onRetry={() => void refetchProducer()} />
      </MintLayout>
    );
  }

  if (!producerProfile) {
    return (
      <MintLayout>
        <NotRegisteredState />
      </MintLayout>
    );
  }

  if (platformFeeError) {
    return (
      <MintLayout>
        <ErrorState message={parseError(platformFeeError)} onRetry={() => void window.location.reload()} />
      </MintLayout>
    );
  }

  return (
    <MintLayout>
      <header className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-lg md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-slate-100">Mint product metadata</h2>
          <p className="text-sm text-slate-300">
            Upload metadata ke IPFS Pinata dan jalankan transaksi untuk mengikat produk ke kontrak V3rific.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/producer"
            className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-100 transition hover:bg-white/5"
          >
            <FaArrowLeft className="text-xs" />
            Back to producer hub
          </Link>
          <ConnectButton chainStatus="icon" accountStatus="address" showBalance={false} />
        </div>
      </header>

      <section className="grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-lg md:grid-cols-[2fr,1fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <FaInfoCircle className="text-indigo-300" />
            Platform fee saat ini: <span className="font-semibold text-indigo-200">{platformFeeDisplay}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMode("single")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                mode === "single"
                  ? "bg-indigo-500 text-white shadow"
                  : "border border-white/10 text-slate-200 hover:bg-white/5"
              }`}
              disabled={mode === "single"}
            >
              <FaBolt className="text-base" />
              Single mint
            </button>
            <button
              type="button"
              onClick={() => setMode("bulk")}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                mode === "bulk"
                  ? "bg-indigo-500 text-white shadow"
                  : "border border-white/10 text-slate-200 hover:bg-white/5"
              }`}
              disabled={mode === "bulk"}
            >
              <FaHive className="text-base" />
              Bulk mint (XLSX)
            </button>
          </div>

          {mode === "single" ? (
            <form onSubmit={singleSubmit} className="space-y-5 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-100">Detail produk</h3>
                <p className="text-sm text-slate-400">
                  Setelah submit, metadata akan dipush ke Pinata dan transaksi mint dijalankan ke kontrak V3rific.
                </p>
                <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-xs text-slate-300">
                  <p className="font-semibold text-indigo-200">Alur otomatis:</p>
                  <ol className="mt-2 space-y-1 list-decimal pl-5">
                    <li>Web mengemas metadata + unitshash unik.</li>
                    <li>Metadata diunggah ke Pinata → menghasilkan CID <code className="font-mono text-indigo-200">ipfs://…</code>.</li>
                    <li>CID dan unitshash dikirim lewat transaksi <code className="font-mono text-indigo-200">mintProduct</code>.</li>
                  </ol>
                  <p className="mt-2 text-slate-400">Kamu tidak perlu memasukkan CID secara manual—semua otomatis.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Product name" required>
                  <input
                    className={INPUT_CLASS}
                    value={singleForm.name}
                    onChange={handleSingleInput("name")}
                    placeholder="Handmade Sketchbook"
                    disabled={singleFormDisabled}
                    required
                  />
                </Field>
                <Field label="SKU / serial" required>
                  <input
                    className={INPUT_CLASS}
                    value={singleForm.sku}
                    onChange={handleSingleInput("sku")}
                    placeholder="HND-2025-001"
                    disabled={singleFormDisabled}
                    required
                  />
                </Field>
                <Field label="Batch / lot" required>
                  <input
                    className={INPUT_CLASS}
                    value={singleForm.batch}
                    onChange={handleSingleInput("batch")}
                    placeholder="Batch A"
                    disabled={singleFormDisabled}
                    required
                  />
                </Field>
                <Field label="Collection">
                  <input
                    className={INPUT_CLASS}
                    value={singleForm.collection}
                    onChange={handleSingleInput("collection")}
                    placeholder="Launch Edition"
                    disabled={singleFormDisabled}
                  />
                </Field>
                <Field label="Product image URL (optional)">
                  <div className="space-y-2">
                    <input
                      className={INPUT_CLASS}
                      value={singleForm.image}
                      onChange={handleSingleInput("image")}
                      placeholder="https://cdn.example.com/product.jpg"
                      disabled={singleFormDisabled}
                    />
                    <p className="text-xs text-slate-400">
                      Nilai ini hanya direferensikan di metadata. Jika butuh tautan IPFS gambar, unggah file melalui alat lain dan masukkan URL-nya di sini.
                    </p>
                  </div>
                </Field>
                <Field label="Origin / location">
                  <input
                    className={INPUT_CLASS}
                    value={singleForm.origin}
                    onChange={handleSingleInput("origin")}
                    placeholder="Bandung, Indonesia"
                    disabled={singleFormDisabled}
                  />
                </Field>
                <Field label="External reference">
                  <input
                    className={INPUT_CLASS}
                    value={singleForm.externalUrl}
                    onChange={handleSingleInput("externalUrl")}
                    placeholder="https://example.com/product"
                    disabled={singleFormDisabled}
                  />
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  className={`${INPUT_CLASS} min-h-[120px]`}
                  value={singleForm.description}
                  onChange={handleSingleInput("description")}
                  placeholder="Describe your product batch, special materials, or certificate references."
                  disabled={singleFormDisabled}
                />
              </Field>

              <Field label="Additional notes">
                <textarea
                  className={`${INPUT_CLASS} min-h-[120px]`}
                  value={singleForm.additionalNotes}
                  onChange={handleSingleInput("additionalNotes")}
                  placeholder="Optional: include QC notes or authenticity statements."
                  disabled={singleFormDisabled}
                />
              </Field>

              {metadataPreview && (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-xs text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-100">Metadata preview (pre-upload)</span>
                    <span className="font-mono text-[10px] text-indigo-300">unitshash → {PREVIEW_UNITSHASH}</span>
                  </div>
                  <p>
                    Struktur JSON yang akan dipush ke Pinata mengikuti skrip contoh Hardhat—termasuk informasi produsen dan atribut SKU/Batch.
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 border border-white/10 p-3 text-[11px] leading-relaxed text-slate-100">
                    {JSON.stringify(metadataPreview, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={singleFormDisabled}
                >
                  <FaBolt className="text-base" />
                  {isConfirming ? "Waiting confirmations..." : isWriting ? "Waiting signature..." : "Mint product"}
                </button>
                <button
                  type="button"
                  onClick={resetSingleForm}
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/5"
                  disabled={singleFormDisabled}
                >
                  Reset form
                </button>
              </div>

              {feedback && (
                <Alert type={feedback.type} message={feedback.message} />
              )}
            </form>
          ) : (
            <div className="space-y-5 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-slate-100">Bulk mint via XLSX template</h3>
                <p className="text-sm text-slate-400">
                  Pastikan kolom <code className="font-mono text-indigo-200">name</code>,{" "}
                  <code className="font-mono text-indigo-200">sku</code>, dan{" "}
                  <code className="font-mono text-indigo-200">batch</code> terisi. Kolom lain opsional.
                </p>
                <div className="rounded-2xl border border-white/10 bg-slate-950/50 p-4 text-xs text-slate-300">
                  <p className="font-semibold text-indigo-200">Struktur XLSX:</p>
                  <p className="mt-1 font-mono text-[11px] text-slate-200">
                    name | description | sku | batch | collection | image | origin | externalUrl | additionalNotes | unitshash
                  </p>
                  <p className="mt-2 text-slate-400">
                    Contoh baris:
                    <span className="block font-mono text-[11px] text-indigo-200">
                      Handmade Sketchbook | Batch peluncuran edisi 50 | HND-2025-001 | Batch A | Spring Drop | ipfs://image |
                      Bandung, ID | https://example.com/sketchbook | Sertifikat QC disertakan | (kosong → otomatis)
                    </span>
                  </p>
                  <p className="mt-2 text-slate-400">
                    Tinggalkan kolom <code className="font-mono text-indigo-200">unitshash</code> kosong untuk digenerate otomatis.
                    Kalau diisi, wajib 8-10 karakter alfanumerik huruf kecil.
                  </p>
                </div>
              </div>

              <label className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-slate-950/50 px-6 py-10 text-center text-sm text-slate-300 transition hover:border-indigo-400/40 hover:bg-slate-950/70">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={handleBulkFile}
                  disabled={bulkInProgress}
                />
                <FaUpload className="text-3xl text-indigo-300" />
                <div>
                  <p className="font-semibold text-slate-100">Upload XLSX file</p>
                  <p className="text-xs text-slate-400">
                    Kolom: name, description, sku, batch, collection, image, origin, externalUrl, additionalNotes, unitshash
                  </p>
                </div>
              </label>

              {bulkRows.length > 0 && (
                <>
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>
                      Total baris valid: <span className="font-semibold text-indigo-200">{bulkRows.length}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkRows([]);
                        setBulkStatuses([]);
                      }}
                      className="text-xs font-semibold text-rose-200 hover:underline"
                    >
                      Clear table
                    </button>
                  </div>

                  <div className="max-h-80 overflow-y-auto rounded-2xl border border-white/10">
                    <table className="min-w-full divide-y divide-white/10 text-left text-xs text-slate-200">
                      <thead className="bg-white/5 font-semibold uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Name</th>
                          <th className="px-4 py-3">SKU</th>
                          <th className="px-4 py-3">Batch</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {bulkRows.map((row, index) => {
                          const status = bulkStatuses[index] ?? { state: "idle" };
                          return (
                            <tr key={`${row.sku}-${index}`} className="hover:bg-white/5">
                              <td className="px-4 py-3 text-sm">{row.name}</td>
                              <td className="px-4 py-3 font-mono text-xs">{row.sku}</td>
                              <td className="px-4 py-3 text-sm">{row.batch}</td>
                              <td className="px-4 py-3 text-xs">
                                <BulkStatusPill status={status} />
                              </td>
                              <td className="px-4 py-3 text-xs text-slate-400">
                                {status.state === "success" ? (
                                  <>
                                    Token ID: {status.tokenId} • Unitshash:{" "}
                                    <span className="font-mono text-indigo-200">{status.unitshash}</span>
                                  </>
                                ) : status.state === "error" ? (
                                  status.message
                                ) : (
                                  row.additionalNotes ?? "-"
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={startBulkMint}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={bulkInProgress}
                    >
                      <FaList className="text-base" />
                      {bulkInProgress ? "Processing..." : "Start bulk mint"}
                    </button>
                    <p className="text-xs text-slate-400">
                      Satu baris = satu transaksi. Perhatikan biaya gas dan platform fee per mint.
                    </p>
                  </div>
                </>
              )}

              {feedback && (
                <Alert type={feedback.type} message={feedback.message} />
              )}
            </div>
          )}
        </div>

        <aside className="space-y-4 rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <h3 className="text-lg font-semibold text-slate-100">Mint tips</h3>
          <ul className="space-y-3 text-sm text-slate-300">
            <li className="flex items-start gap-3">
              <FaShuffle className="mt-1 text-base text-indigo-300" />
              <span>
                <strong>Unitshash unik</strong> dihasilkan otomatis. Anda dapat men-override melalui kolom
                <code className="ml-1 font-mono text-indigo-200">unitshash</code> di template bulk.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <FaInfoCircle className="mt-1 text-base text-indigo-300" />
              <span>
                Metadata yang diunggah ke Pinata akan menyertakan informasi produsen, sehingga dapat diverifikasi dari kontrak.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <FaExclamationTriangle className="mt-1 text-base text-amber-300" />
              <span>
                Pastikan Anda memiliki saldo ETH yang cukup untuk <em>gas fee</em> dan platform fee {platformFeeDisplay}.
              </span>
            </li>
          </ul>
        </aside>
      </section>
    </MintLayout>
  );
}

function MintLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-400 font-extrabold text-slate-900 shadow-lg">
              V3
            </div>
            <div>
              <h1 className="text-xl font-semibold">Producer Mint</h1>
              <p className="text-sm text-slate-300">Upload metadata & bind product authenticity on-chain.</p>
            </div>
          </div>
        </header>

        {children}
      </div>
    </main>
  );
}

function DisconnectedState() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-center text-sm text-slate-300">
      <p className="text-lg font-semibold text-slate-100">Hubungkan wallet untuk mulai minting.</p>
      <div className="mt-4 inline-flex rounded-xl border border-white/15 bg-slate-900/60 px-4 py-3">
        <ConnectButton chainStatus="icon" accountStatus="address" showBalance={false} />
      </div>
    </div>
  );
}

function NotRegisteredState() {
  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-white/5 p-10 text-center text-sm text-slate-300">
      <p className="text-lg font-semibold text-slate-100">Anda belum terdaftar pada registry produsen.</p>
      <p>Silakan selesaikan proses pendaftaran terlebih dahulu.</p>
      <Link
        href="/producer"
        className="inline-flex items-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-indigo-400"
      >
        <FaArrowLeft className="text-xs" />
        Kembali ke halaman registrasi
      </Link>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-10 text-sm text-slate-300">
      Mengambil data producer dan platform fee…
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2 text-sm text-slate-200">
      <span className="font-medium text-slate-300">
        {label}
        {required ? <span className="ml-1 text-rose-300">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function Alert({ type, message }: { type: "success" | "error" | "pending"; message: string }) {
  const styles =
    type === "success"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
      : type === "error"
      ? "border-rose-400/40 bg-rose-500/10 text-rose-100"
      : "border-indigo-400/40 bg-indigo-500/10 text-indigo-100";

  const icon =
    type === "success" ? (
      <FaCheckCircle className="text-base" />
    ) : type === "error" ? (
      <FaTimesCircle className="text-base" />
    ) : (
      <FaInfoCircle className="text-base" />
    );

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      {icon}
      <span>{message}</span>
    </div>
  );
}

function BulkStatusPill({ status }: { status: BulkItemStatus }) {
  switch (status.state) {
    case "idle":
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-300">
          Pending
        </span>
      );
    case "uploading":
    case "pinning":
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-100">
          Uploading metadata…
        </span>
      );
    case "awaiting-signature":
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs text-amber-100">
          Waiting signature…
        </span>
      );
    case "confirming":
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-100">
          Confirming tx…
        </span>
      );
    case "success":
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-100">
          Minted
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1 text-xs text-rose-100">
          Failed
        </span>
      );
    default:
      return null;
  }
}

type MetadataProducerInfo = {
  address: string;
  name: string;
  verified: boolean;
};

function buildMetadataPayload(
  base: SingleFormValues,
  unitshash: string,
  producer: MetadataProducerInfo,
  options: { preview?: boolean } = {}
) {
  const payload: Record<string, unknown> = {
    name: base.name,
    description: base.description,
    sku: base.sku,
    batch: base.batch,
    collection: base.collection || undefined,
    image: base.image || undefined,
    origin: base.origin || undefined,
    external_url: base.externalUrl || undefined,
    additionalNotes: base.additionalNotes || undefined,
    unitshash,
    producer: {
      address: producer.address,
      name: producer.name,
      verified: producer.verified,
    },
    attributes: [
      { trait_type: "SKU", value: base.sku || "N/A" },
      { trait_type: "Batch", value: base.batch || "N/A" },
      { trait_type: "Origin", value: base.origin || "N/A" },
      { trait_type: "Collection", value: base.collection || "N/A" },
    ],
    generatedAt: options.preview ? "preview-mode" : new Date().toISOString(),
  };

  if (!payload.collection) {
    delete payload.collection;
  }
  if (!payload.image) {
    delete payload.image;
  }
  if (!payload.origin) {
    delete payload.origin;
  }
  if (!payload.external_url) {
    delete payload.external_url;
  }
  if (!payload.additionalNotes) {
    delete payload.additionalNotes;
  }

  return payload;
}

async function uploadMetadata(metadata: Record<string, unknown>): Promise<string> {
  const response = await fetch("/api/pinata/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      metadata: {
        ...metadata,
        timestamp: new Date().toISOString(),
      },
    }),
  });

  if (!response.ok) {
    const { error } = await response.json();
    throw new Error(error ?? "Gagal mengunggah metadata ke Pinata.");
  }

  const { cid } = (await response.json()) as { cid: string };
  return cid;
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
