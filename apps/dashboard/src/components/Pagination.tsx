"use client";

import { useCallback } from "react";

/**
 * Reusable pagination component.
 *
 * Usage:
 *   <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
 */
export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-gray-200 pt-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Previous
      </button>
      <span className="text-sm text-gray-500">
        Page {currentPage} of {totalPages}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}

/**
 * Hook for managing pagination state.
 *
 * Usage:
 *   const { currentPage, totalPages, setPage } = usePagination(totalCount, 25);
 */
export function usePagination(totalCount: number, pageSize: number = 25) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const getSkip = useCallback((page: number) => (page - 1) * pageSize, [pageSize]);

  return {
    totalPages,
    pageSize,
    getSkip,
  };
}
