-- Store the roles granted by an invite so signup can create UserRole rows atomically.
CREATE TABLE "InviteTokenRole" (
    "id" TEXT NOT NULL,
    "inviteTokenId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteTokenRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteTokenRole_inviteTokenId_role_key" ON "InviteTokenRole"("inviteTokenId", "role");
CREATE INDEX "InviteTokenRole_inviteTokenId_idx" ON "InviteTokenRole"("inviteTokenId");

ALTER TABLE "InviteTokenRole" ADD CONSTRAINT "InviteTokenRole_inviteTokenId_fkey" FOREIGN KEY ("inviteTokenId") REFERENCES "InviteToken"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
