/** All money is integer paisa (100 paisa = ৳1). All timestamps are ISO 8601. */
export type Role = 'owner' | 'staff' | 'customer';
export interface User { id: number; name: string; username: string; email: string; role: Role; phone?: string; address?: string; emailVerified?: boolean; phoneVerified?: boolean; firebaseLinked?: boolean; isDemo?: boolean; avatarUrl?: string | null; avatarUploadId?: number | null }
export interface AuthResponse { token: string; refreshToken: string; user: User }
export interface Product {
  id: number; name: string; category: string; unit: string; price: number;
  description: string; emoji: string; inStock: boolean; averageRating: number; reviewCount: number;
  imageUrl?: string | null; uploadId?: number | null;
}
export interface InventoryProduct extends Product { stock: number; cost: number; reorderLevel: number }
export interface ProductPage { items: Product[]; total: number; page: number; pages: number; categories: string[] }
export interface Review { id: number; productId: number; userId: number; author: string; rating: number; body: string; createdAt: string }
export interface Shop {
  name: string; tagline: string; phone: string; email: string; address: string;
  openingHours: string; latitude: number | null; longitude: number | null; currency: string; demo: boolean;
}
export interface Dashboard {
  sales: number; grossProfit: number; expenses: number; netProfit: number;
  cashCollected: number; dues: number; lowStock: InventoryProduct[];
  salesSeries: { date: string; sales: number }[]; inventoryCost?: number; totalProducts: number;
}
export interface Customer {
  id: number; name: string; phone: string; email: string; address: string;
  purchases: number; totalSpent: number; due: number; openingDue?: number; openingSettled?: number; userId?: number | null; avatarUrl?: string | null;
}
export interface Activity { id: number; type: 'sale' | 'purchase' | 'expense' | 'payment'; title: string; amount: number; createdAt: string }
export interface SaleInput {
  items: { productId: number; quantity: number }[];
  customerId?: number; customerName?: string; paid: number; previousDuePayment?: number; requestId: string;
}
export interface SaleResult { id: number; total: number; paid: number; due: number; previousDue?: number; previousDuePayment?: number; customerBalance?: number }
