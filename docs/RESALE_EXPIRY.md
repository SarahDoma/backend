# Resale Listing Expiry, Limits, and Audit History

## Overview

This document describes the resale marketplace enhancements implemented for resale listings on StellarTickets.

## Features

### 1. Resale Listing Expiration (`expiresAt`)
- Sellers can optionally provide an expiration timestamp (`expiresAt`) when creating a resale listing.
- The `ResaleExpiryService` periodically inspects active resale listings where `expiresAt <= now()`.
- Expired listings have their status transitioned to `CANCELLED`, and the underlying ticket's status is reverted to `VALID`.

### 2. Configurable Soft Limit Cap
- Prevents sellers from flooding the marketplace with excessive listings.
- Configured via the `MAX_ACTIVE_RESALE_LISTINGS_PER_USER` environment variable (default: `5`).
- Listing creation requests exceeding this limit throw an HTTP 409 (`ConflictException`).

### 3. Resale Price History Audit
- Every price set or updated on a resale listing is recorded in the `ResalePriceHistory` audit table.
- Accessible via the `GET /tickets/resale/:listingId/price-history` endpoint.
- Updated via the `PATCH /tickets/resale/:listingId/price` endpoint.
