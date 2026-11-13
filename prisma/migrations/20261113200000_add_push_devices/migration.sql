CREATE TABLE "push_devices" (
    "device_id" UUID NOT NULL,
    "user_id" VARCHAR(128) NOT NULL,
    "token" VARCHAR(4096) NOT NULL,
    "platform" VARCHAR(7) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_devices_pkey" PRIMARY KEY ("device_id"),
    CONSTRAINT "push_devices_platform_check" CHECK ("platform" IN ('android', 'ios'))
);

CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");
