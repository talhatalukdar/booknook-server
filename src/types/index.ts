import type { ObjectId } from "mongodb";

export const CATEGORIES = ["Fiction", "Science", "History", "Kids", "Others"] as const;
export type Category = (typeof CATEGORIES)[number];

export interface BookDoc {
  _id: ObjectId;
  title: string;
  author: string;
  category: Category;
  image: string;
  description: string;
  addedByUserId: string;
  addedByName: string;
  addedByEmail: string;
  totalCopies: number;
  availableCopies: number;
  addedAt: Date;
  updatedAt: Date;
}

export type BorrowStatus = "active" | "returned";

export interface BorrowDoc {
  _id: ObjectId;
  bookId: ObjectId;
  bookTitle: string;
  bookImage: string;
  userId: string;
  userName: string;
  userEmail: string;
  borrowDate: Date;
  returnDate: Date;
  status: BorrowStatus;
  returnedAt: Date | null;
  createdAt: Date;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
