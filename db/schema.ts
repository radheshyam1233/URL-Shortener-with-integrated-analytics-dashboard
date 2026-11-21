import { index, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const links = pgTable('links', {
  code: text().primaryKey(),
  url: text().notNull(),
  createdCity: text('created_city'),
  createdCountry: text('created_country'),
  ownerHash: text('owner_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clicks = pgTable('clicks', {
  id: serial().primaryKey(),
  code: text().notNull().references(() => links.code, { onDelete: 'cascade' }),
  timestamp: timestamp({ withTimezone: true }).notNull().defaultNow(),
  city: text(),
  country: text(),
  region: text(),
  referrer: text().notNull().default('Direct'),
}, (table) => [index('clicks_code_timestamp_idx').on(table.code, table.timestamp.desc())]);
