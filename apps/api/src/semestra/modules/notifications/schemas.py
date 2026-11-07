from pydantic import BaseModel, Field


class DeviceIn(BaseModel):
    """`PushSubscription.toJSON()` of this browser."""

    endpoint: str = Field(max_length=2048, description="Push service URL")
    p256dh: str = Field(max_length=256, description="Browser's public key, base64url")
    auth: str = Field(max_length=64, description="Authentication secret, base64url")


class DeviceRef(BaseModel):
    endpoint: str = Field(max_length=2048, description="Push service URL of the device")


class PushConfig(BaseModel):
    public_key: str = Field(description="VAPID public key for PushManager.subscribe")


class DeviceRegistered(BaseModel):
    ok: bool = True


class TestSent(BaseModel):
    delivered: int = Field(description="How many devices accepted the test notification")
