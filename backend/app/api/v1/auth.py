"""
FastAPI router for authentication and user management.
"""

from uuid import UUID
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr

from app.core.database import get_db
from app.core.security import (
    get_current_user,
    create_access_token,
    get_password_hash,
    verify_password
)
from app.models.user import User, UserProfile
from app.schemas.portfolio import PortfolioCreate

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    """User registration request."""
    email: EmailStr
    password: str
    display_name: str


class LoginRequest(BaseModel):
    """User login request."""
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    """Token response."""
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserProfileUpdate(BaseModel):
    """User profile update request."""
    display_name: str | None = None
    timezone: str | None = None
    preferred_markets: list[str] | None = None
    preferred_themes: list[str] | None = None
    notification_channels: dict | None = None


class UserProfileRead(BaseModel):
    """User profile response."""
    id: UUID
    user_id: UUID
    display_name: str | None
    timezone: str
    preferred_markets: list[str]
    preferred_themes: list[str]
    notification_channels: dict
    
    class Config:
        from_attributes = True


@router.post("/register", response_model=TokenResponse)
async def register(
    request: RegisterRequest,
    db: AsyncSession = Depends(get_db)
):
    """Register a new user account."""
    import logging
    _log = logging.getLogger(__name__)

    try:
        # Check if user already exists
        result = await db.execute(
            select(User).where(User.email == request.email)
        )
        if result.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )

        # Hash password
        try:
            hashed = get_password_hash(request.password)
        except Exception as e:
            _log.error(f"Password hashing failed: {e}")
            raise HTTPException(status_code=500, detail=f"Password hashing failed: {e}")

        # Create user
        user = User(
            email=request.email,
            hashed_password=hashed,
            is_active=True
        )
        db.add(user)
        await db.flush()

        # Create user profile
        profile = UserProfile(
            user_id=user.id,
            display_name=request.display_name,
            timezone="UTC",
            preferred_markets=["IN", "US"],
            preferred_themes=["earnings", "sector_rotation"],
            notification_channels={"email": True, "telegram": False, "browser": True}
        )
        db.add(profile)

        # Create default portfolio
        from app.models.portfolio import Portfolio
        portfolio = Portfolio(
            user_id=user.id,
            name="Main Portfolio",
            currency="USD",
            is_primary=True
        )
        db.add(portfolio)

        await db.commit()

        # Generate token
        access_token = create_access_token(
            data={"sub": str(user.id)},
            expires_delta=timedelta(minutes=43200)  # 30 days
        )

        return {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": 43200 * 60
        }
    except HTTPException:
        raise
    except Exception as e:
        _log.error(f"Registration failed: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


@router.post("/login", response_model=TokenResponse)
async def login(
    request: LoginRequest,
    db: AsyncSession = Depends(get_db)
):
    """Login user and return JWT token."""
    # Find user by email
    result = await db.execute(
        select(User).where(User.email == request.email)
    )
    user = result.scalars().first()
    
    if not user or not verify_password(request.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )
    
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    # Generate token
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=43200)
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 43200 * 60
    }


@router.get("/me", response_model=UserProfileRead)
async def get_current_user_profile(
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get current user's profile."""
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == UUID(user_id))
    )
    profile = result.scalars().first()
    
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    return profile


@router.patch("/me", response_model=UserProfileRead)
async def update_user_profile(
    request: UserProfileUpdate,
    user_id: str = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Update user profile."""
    result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == UUID(user_id))
    )
    profile = result.scalars().first()
    
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    
    if request.display_name is not None:
        profile.display_name = request.display_name
    if request.timezone is not None:
        profile.timezone = request.timezone
    if request.preferred_markets is not None:
        profile.preferred_markets = request.preferred_markets
    if request.preferred_themes is not None:
        profile.preferred_themes = request.preferred_themes
    if request.notification_channels is not None:
        profile.notification_channels = request.notification_channels
    
    await db.commit()
    await db.refresh(profile)
    return profile


@router.post("/logout")
async def logout(
    user_id: str = Depends(get_current_user)
):
    """Logout user (token invalidation via Redis blocklist)."""
    # In production, would add token to Redis blocklist
    return {"message": "Logged out successfully"}
