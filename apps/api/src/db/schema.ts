import { pgTable, uuid, text, timestamp, jsonb, boolean, varchar, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Users table - authentication and user management
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Projects table - main workspace containers
export const projects = pgTable('projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').references(() => users.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Project memberships - user access to projects
export const memberships = pgTable('memberships', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('member'), // owner, admin, member, viewer
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// Installed bobbins per project
export const bobbinsInstalled = pgTable('bobbins_installed', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  manifestJson: jsonb('manifest_json').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  installedAt: timestamp('installed_at').defaultNow().notNull()
})

// Manifest versions registry
export const manifestsVersions = pgTable('manifests_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  version: varchar('version', { length: 50 }).notNull(),
  manifestJson: jsonb('manifest_json').notNull(),
  signature: text('signature'), // For future validation/integrity
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// Publish targets - static site generation results
export const publishTargets = pgTable('publish_targets', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // snapshot, live, preview
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, building, ready, failed
  url: text('url'),
  versionId: varchar('version_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
})

// Entities table - Tier 1 JSONB storage for all collections
export const entities = pgTable('entities', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  bobbinId: varchar('bobbin_id', { length: 255 }).notNull(),
  collectionName: varchar('collection_name', { length: 255 }).notNull(),
  entityData: jsonb('entity_data').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull()
}, (table) => ({
  projectCollectionIdx: index('entities_project_collection_idx').on(table.projectId, table.collectionName),
  searchIdx: index('entities_search_idx').using('gin', table.entityData),
  orderIdx: index('entities_order_idx').on(table.projectId, table.collectionName, table.entityData)
}))

// Provenance events - audit trail for security and compliance
export const provenanceEvents = pgTable('provenance_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => projects.id).notNull(),
  entityRef: varchar('entity_ref', { length: 512 }), // project_id:bobbin_id:collection:entity_id format
  actor: varchar('actor', { length: 255 }).notNull(), // user_id or system
  action: varchar('action', { length: 100 }).notNull(), // create, update, delete, publish, ai_assist, external_call
  metaJson: jsonb('meta_json'), // Additional context data
  createdAt: timestamp('created_at').defaultNow().notNull()
})

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  memberships: many(memberships)
}))

export const projectsRelations = relations(projects, ({ one, many }) => ({
  owner: one(users, {
    fields: [projects.ownerId],
    references: [users.id]
  }),
  memberships: many(memberships),
  bobbinsInstalled: many(bobbinsInstalled),
  entities: many(entities),
  publishTargets: many(publishTargets),
  provenanceEvents: many(provenanceEvents)
}))

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id]
  }),
  project: one(projects, {
    fields: [memberships.projectId],
    references: [projects.id]
  })
}))

export const bobbinsInstalledRelations = relations(bobbinsInstalled, ({ one }) => ({
  project: one(projects, {
    fields: [bobbinsInstalled.projectId],
    references: [projects.id]
  })
}))

export const publishTargetsRelations = relations(publishTargets, ({ one }) => ({
  project: one(projects, {
    fields: [publishTargets.projectId],
    references: [projects.id]
  })
}))

export const entitiesRelations = relations(entities, ({ one }) => ({
  project: one(projects, {
    fields: [entities.projectId],
    references: [projects.id]
  })
}))

export const provenanceEventsRelations = relations(provenanceEvents, ({ one }) => ({
  project: one(projects, {
    fields: [provenanceEvents.projectId],
    references: [projects.id]
  })
}))