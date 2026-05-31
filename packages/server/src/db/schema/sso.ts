import { relations } from "drizzle-orm";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organization } from "./account";
import { user } from "./user";

export const ssoProvider = pgTable("sso_provider", {
	id: text("id").primaryKey(),
	issuer: text("issuer").notNull(),
	oidcConfig: text("oidc_config"),
	samlConfig: text("saml_config"),
	providerId: text("provider_id").notNull().unique(),
	userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
	organizationId: text("organization_id").references(() => organization.id, {
		onDelete: "cascade",
	}),
	domain: text("domain").notNull(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
	organization: one(organization, {
		fields: [ssoProvider.organizationId],
		references: [organization.id],
	}),
	user: one(user, {
		fields: [ssoProvider.userId],
		references: [user.id],
	}),
}));
