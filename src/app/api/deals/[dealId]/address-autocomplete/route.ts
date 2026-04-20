import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import {
  assertDealInCurrentOrganization,
  NO_CURRENT_ORGANIZATION_MESSAGE,
} from "@/lib/deals/organizationScope";

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
  error?: {
    message?: string;
  };
};

type GooglePlaceDetailsResponse = {
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
  formattedAddress?: string;
  error?: {
    message?: string;
  };
};

function getGoogleMapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

function getComponent(
  components: GooglePlaceDetailsResponse["addressComponents"],
  type: string,
  variant: "longText" | "shortText" = "longText"
) {
  return components?.find((component) => component.types?.includes(type))?.[variant] ?? "";
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await params;
  const apiKey = getGoogleMapsApiKey();

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "Google Places is not configured. Set GOOGLE_MAPS_API_KEY to enable address lookup.",
      },
      { status: 503 }
    );
  }

  const supabase = await supabaseServer();
  const scopedDeal = await assertDealInCurrentOrganization(supabase, dealId);

  if (!scopedDeal.organizationId) {
    return NextResponse.json(
      { error: NO_CURRENT_ORGANIZATION_MESSAGE },
      { status: 400 }
    );
  }

  if (scopedDeal.error) {
    return NextResponse.json(
      { error: "Failed to load deal", details: scopedDeal.error.message },
      { status: 500 }
    );
  }

  if (!scopedDeal.data) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const placeId = searchParams.get("placeId")?.trim() ?? "";

  if (placeId) {
    const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "formattedAddress,addressComponents",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as GooglePlaceDetailsResponse;

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Failed to load Google place details",
          details: payload.error?.message ?? "Unknown Google Places error",
        },
        { status: 502 }
      );
    }

    const streetNumber = getComponent(payload.addressComponents, "street_number");
    const route = getComponent(payload.addressComponents, "route");
    const line1 = [streetNumber, route].filter(Boolean).join(" ").trim();
    const city =
      getComponent(payload.addressComponents, "locality") ||
      getComponent(payload.addressComponents, "postal_town") ||
      getComponent(payload.addressComponents, "sublocality") ||
      getComponent(payload.addressComponents, "administrative_area_level_3");
    const state = getComponent(payload.addressComponents, "administrative_area_level_1", "shortText");
    const zip = getComponent(payload.addressComponents, "postal_code");

    return NextResponse.json({
      ok: true,
      address: {
        label: payload.formattedAddress ?? line1,
        address_line1: line1,
        city,
        state,
        zip,
      },
    });
  }

  if (q.length < 3) {
    return NextResponse.json({ ok: true, suggestions: [] });
  }

  const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat.mainText.text,suggestions.placePrediction.structuredFormat.secondaryText.text",
    },
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ["US"],
      languageCode: "en-US",
      regionCode: "US",
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as GoogleAutocompleteResponse;

  if (!response.ok) {
    return NextResponse.json(
      {
        error: "Failed to load Google address suggestions",
        details: payload.error?.message ?? "Unknown Google Places error",
      },
      { status: 502 }
    );
  }

  const suggestions = (payload.suggestions ?? [])
    .map((item) => {
      const prediction = item.placePrediction;
      const placeIdValue = prediction?.placeId?.trim();
      const label =
        prediction?.text?.text?.trim() ||
        [
          prediction?.structuredFormat?.mainText?.text?.trim(),
          prediction?.structuredFormat?.secondaryText?.text?.trim(),
        ]
          .filter(Boolean)
          .join(", ");

      if (!placeIdValue || !label) return null;

      return {
        placeId: placeIdValue,
        label,
      };
    })
    .filter((item): item is { placeId: string; label: string } => Boolean(item))
    .slice(0, 5);

  return NextResponse.json({ ok: true, suggestions });
}
