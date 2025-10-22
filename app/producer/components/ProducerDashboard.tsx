import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FaArrowRight, FaCheckCircle, FaTimesCircle } from "react-icons/fa";

export type ProducerProfile = {
  name: string;
  description: string;
  website: string;
  contact: string;
  country: string;
  registered: boolean;
  verified: boolean;
  registeredAt: string; // epoch seconds as string
  admin: string;
};

export type ProductSummary = {
  id: string;
  name: string;
  sku: string;
  batch: string;
  status: string;
  mintedAt: string; // ISO date string
  unitshash: string;
};

type ProducerDashboardProps = {
  profile: ProducerProfile;
  products: ProductSummary[];
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  onRefresh?: () => void;
};

const PAGE_SIZE = 10;

export function ProducerDashboard({
  profile,
  products,
  isLoading,
  errorMessage,
  onRetry,
  onRefresh,
}: ProducerDashboardProps) {
  const [page, setPage] = useState(1);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, products.length]);

  const { items, totalPages } = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return {
      items: products.slice(start, end),
      totalPages,
    };
  }, [page, products]);

  const goToPrev = () => setPage((current) => Math.max(1, current - 1));
  const goToNext = () => setPage((current) => Math.min(totalPages, current + 1));

  return (
    <motion.section
      className="space-y-8 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-lg"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-slate-100">Welcome back, {profile.name} 👋</h2>
          <p className="text-sm text-slate-300">
            This dashboard mirrors what the on-chain registry will expose once the integration is complete.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Refresh
            </button>
          )}
          <Link
            href="/producer/mint"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow transition hover:bg-indigo-400"
          >
            Create new product
            <FaArrowRight className="text-xs" />
          </Link>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <StatusCard label="Registered" success={profile.registered} />
        <StatusCard label="Verified" success={profile.verified} />
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-300">
          <p>
            Registered on{" "}
            <span className="font-semibold text-indigo-200">
              {formatRegisteredDate(profile.registeredAt)}
            </span>
          </p>
          <p className="mt-1">Country: {profile.country}</p>
          <p className="mt-1">
            Contact:{" "}
            <a href={`mailto:${profile.contact}`} className="text-indigo-300 hover:underline">
              {profile.contact}
            </a>
          </p>
          <p className="mt-1">
            Admin: <AdminAddress value={profile.admin} />
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-6 text-sm text-slate-300 leading-relaxed">
        <h3 className="text-lg font-semibold text-slate-100">Brand description</h3>
        <p className="mt-2">{profile.description}</p>
        <a href={profile.website} className="mt-3 inline-flex text-indigo-300 hover:underline">
          {profile.website}
        </a>
      </div>

      <section className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/60 p-6">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Recent product batches</h3>
            <p className="text-sm text-slate-400">
              Listing products minted on the V3rific contract for this producer address.
            </p>
          </div>
        </header>

        {isLoading && products.length > 0 && (
          <div className="text-xs text-slate-500">Refreshing on-chain data…</div>
        )}

        {!isLoading && errorMessage && products.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <span>{errorMessage}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center justify-center rounded-lg border border-amber-400/40 px-3 py-1 text-[11px] font-semibold text-amber-100 transition hover:bg-amber-500/10"
              >
                Retry
              </button>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-white/10 text-left text-sm text-slate-200">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Product</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Minted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading && products.length === 0 && (
                <tr className="animate-pulse">
                  <td className="px-4 py-3">
                    <div className="h-4 w-40 rounded bg-white/10" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-28 rounded bg-white/10" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-24 rounded bg-white/10" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-20 rounded bg-white/10" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="h-4 w-24 rounded bg-white/10" />
                  </td>
                </tr>
              )}

              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-400">
                    {errorMessage ? (
                      <div className="space-y-3">
                        <p>{errorMessage}</p>
                        {onRetry && (
                          <button
                            type="button"
                            onClick={onRetry}
                            className="inline-flex items-center justify-center rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/5"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    ) : (
                      "No products minted yet."
                    )}
                  </td>
                </tr>
              )}

              {!isLoading &&
                items.map((item) => (
                  <tr key={item.id} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-slate-100">{item.name}</div>
                      <Link
                        href={`/search/${item.unitshash}`}
                        className="mt-1 inline-flex text-xs font-mono text-indigo-300 hover:underline"
                      >
                        #{item.unitshash.toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{item.sku}</td>
                    <td className="px-4 py-3 text-sm">{item.batch}</td>
                    <td className="px-4 py-3 text-sm">
                      <StatusPill status={item.status} />
                    </td>
                    <td className="px-4 py-3 text-sm">{formatMintedDate(item.mintedAt)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {products.length > 0
              ? `Showing ${(page - 1) * PAGE_SIZE + 1}-${Math.min(page * PAGE_SIZE, products.length)} of ${products.length} items`
              : "No items to display"}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPrev}
              disabled={page === 1}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Previous
            </button>
            <span className="text-xs text-slate-300">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={goToNext}
              disabled={page === totalPages}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </footer>
      </section>
    </motion.section>
  );
}

function formatRegisteredDate(value: string) {
  const timestamp = Number(value) * 1000;
  if (!Number.isFinite(timestamp)) {
    return "N/A";
  }

  return new Date(timestamp).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMintedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "N/A";
  }

  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function AdminAddress({ value }: { value: string }) {
  if (!value) {
    return <span className="font-mono text-slate-400">N/A</span>;
  }

  return (
    <span className="font-mono text-indigo-200">
      {value.slice(0, 6)}…{value.slice(-4)}
    </span>
  );
}

function StatusCard({ label, success }: { label: string; success: boolean }) {
  const Icon = success ? FaCheckCircle : FaTimesCircle;
  const badgeStyles = success
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
    : "border-amber-500/40 bg-amber-500/10 text-amber-100";

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4">
      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${badgeStyles}`}>
        <Icon className="text-base" />
        {label}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/40 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-100">
      {status}
    </span>
  );
}
