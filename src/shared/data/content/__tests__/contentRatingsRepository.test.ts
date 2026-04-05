import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockAddDoc,
  mockDeleteDoc,
  mockGetDocs,
  mockSetDoc,
  mockCollection,
  mockDocRef,
} = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockDeleteDoc: vi.fn(),
  mockGetDocs: vi.fn(),
  mockSetDoc: vi.fn(),
  mockCollection: vi.fn((_db, name) => `collection:${name}`),
  mockDocRef: { id: "existing-rating-doc" },
}));

vi.mock("@/firebase", () => ({
  db: {},
}));

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => ({ args }),
  serverTimestamp: () => "server-ts",
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  where: (...args: unknown[]) => ({ args }),
}));

import {
  getUserRating,
  setContentRating,
} from "../contentRatingsRepository";

describe("contentRatingsRepository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no rating exists", async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: true,
      docs: [],
    });

    const result = await getUserRating("u1", "c1");

    expect(result).toBeNull();
  });

  it("removes existing rating when user taps the same rating", async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          data: () => ({ rating: "like" }),
          ref: mockDocRef,
        },
      ],
    });

    const result = await setContentRating("u1", "c1", "sound", "like");

    expect(mockDeleteDoc).toHaveBeenCalledWith(mockDocRef);
    expect(result).toBeNull();
  });

  it("updates existing rating when value changes", async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          data: () => ({ rating: "dislike" }),
          ref: mockDocRef,
        },
      ],
    });

    const result = await setContentRating("u1", "c1", "sound", "like");

    expect(mockSetDoc).toHaveBeenCalledWith(
      mockDocRef,
      expect.objectContaining({
        user_id: "u1",
        content_id: "c1",
        content_type: "sound",
        rating: "like",
      })
    );
    expect(result).toBe("like");
  });

  it("creates a new rating when none exists", async () => {
    mockGetDocs.mockResolvedValueOnce({
      empty: true,
      docs: [],
    });

    const result = await setContentRating("u1", "c1", "sound", "dislike");

    expect(mockAddDoc).toHaveBeenCalledWith(
      "collection:content_ratings",
      expect.objectContaining({
        user_id: "u1",
        content_id: "c1",
        content_type: "sound",
        rating: "dislike",
      })
    );
    expect(result).toBe("dislike");
  });
});
