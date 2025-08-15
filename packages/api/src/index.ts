import Fastify, { FastifyInstance } from "fastify";
import { prisma } from "prisma-database";
import exampleRoutes from "./routes/example";
import { subMinutes } from "date-fns";

// const MAX_AGE_MIN = 60; // e.g., 60 minutes
// const freshCutoff = subMinutes(new Date(), MAX_AGE_MIN);

const app = Fastify({ logger: true });
app.register(exampleRoutes);

app.get("/ping", async (request, reply) => {
  return { pong: true };
});

app.get("/readings", async (request, reply) => {
  const readings = await prisma.location.findMany();
  return readings;
});

// app.get("/air-quality-index", async (request, reply) => {
//   try {
//     const latestFresh = await prisma.measurement.findFirst({
//       where: {
//         type: "AQI",
//         recordedAt: { gte: freshCutoff },
//         location: { zip: "90210" },
//       },
//       orderBy: { recordedAt: "desc" },
//       select: { value: true, unit: true, recordedAt: true, source: true },
//     });
//     if (latestFresh !== null) {
//       reply
//         .code(200)
//         .header("Content-Type", "application/json")
//         .send(latestFresh);
//     } else {
//       const url = new URL(
//         "https://www.airnowapi.org/aq/observation/zipCode/current/"
//       );
//       url.search = new URLSearchParams({
//         format: "application/json",
//         zipCode: "48083",
//         distance: "25",
//         API_KEY: "2417D6CA-D0D2-470C-BD0E-CB049A7B944A",
//       }).toString();
//       const res = await fetch(url.toString(), {
//         signal: AbortSignal.timeout(10_000),
//       });
//       if (!res.ok) {
//         return reply
//           .code(502)
//           .send({ error: { code: "UPSTREAM_AIRNOW", status: res.status } });
//       }

//       const data = await res.json();

//       reply.code(200).header("Content-Type", "application/json").send(data);
//     }
//   } catch (err: any) {
//     request.log.error({ err }, "AirNow fetch failed");
//     reply
//       .code(500)
//       .send({ error: { code: "INTERNAL", message: "Failed to fetch AirNow" } });
//   }
// });

// How fresh do we require DB data to be?
const FRESH_MINUTES = 60;

function freshCutoffDate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - FRESH_MINUTES);
  return d;
}

type AirNowObservation = {
  DateObserved: string; // "2025-08-15"
  HourObserved: number; // e.g. 14
  LocalTimeZone: string; // "PST" (not an IANA tz)
  ReportingArea: string; // "Los Angeles"
  StateCode: string; // "CA"
  Latitude: number;
  Longitude: number;
  ParameterName: string; // "PM2.5" | "O3" | ...
  AQI: number;
  Category: { Number: number; Name: string };
};

async function fetchAirNow(zip: string): Promise<AirNowObservation[]> {
  const url = new URL(
    "https://www.airnowapi.org/aq/observation/zipCode/current/"
  );
  url.search = new URLSearchParams({
    format: "application/json",
    zipCode: zip,
    distance: "25",
    API_KEY: process.env.EPA_API_KEY ?? "2417D6CA-D0D2-470C-BD0E-CB049A7B944A",
  }).toString();

  const res = await fetch(url.toString(), {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`AirNow ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data as AirNowObservation[];
}

// choose the best single AQI value from the observation set
function pickBestAqi(
  airNowObservationResponse: AirNowObservation[] | null | undefined
) {
  if (!airNowObservationResponse || airNowObservationResponse.length === 0)
    return null;
  // pick the highest AQI among pollutants (PM2.5/O3/etc.)
  const best = airNowObservationResponse.reduce((a, b) =>
    a.AQI >= b.AQI ? a : b
  );
  // Build a recordedAt using the observed local hour. AirNow gives a local tz
  // label (not IANA); we’ll store as UTC by composing date+hour from the string.
  // This is “good enough” for freshness gating; if you need precise tz handling,
  // convert from the reporting area’s lat/lng via a tz DB.
  const recordedAt = new Date(
    `${best.DateObserved}T${String(best.HourObserved).padStart(2, "0")}:00:00`
  );
  return {
    value: best.AQI,
    unit: "US AQI",
    source: "EPA_AirNow",
    recordedAt,
    latitude: best.Latitude,
    longitude: best.Longitude,
    name: best.ReportingArea,
  };
}

app.get("/climate", async (request, reply) => {
  const zip = String((request.query as any).zip ?? "90210"); // or validate with zod
  const cutoff = freshCutoffDate();

  // 1) try fresh from DB
  const latestFresh = await prisma.measurement.findFirst({
    where: { type: "AQI", recordedAt: { gte: cutoff }, location: { zip } },
    orderBy: { recordedAt: "desc" },
    select: { value: true, unit: true, recordedAt: true, source: true },
  });

  if (latestFresh) {
    return reply.code(200).send({ zip, ...latestFresh, fresh: true });
  }

  // 2) fetch upstream + write-through to DB
  try {
    const airNowObservationResponse = await fetchAirNow(zip);
    const worstAirQualityMeasurement = pickBestAqi(airNowObservationResponse);

    if (!worstAirQualityMeasurement) {
      // no upstream data: fall back to latest stale DB row if present
      const latestAny = await prisma.measurement.findFirst({
        where: { type: "AQI", location: { zip } },
        orderBy: { recordedAt: "desc" },
        select: { value: true, unit: true, recordedAt: true, source: true },
      });
      if (latestAny) {
        return reply.code(200).send({ zip, ...latestAny, fresh: false });
      }
      return reply.code(404).send({ error: { code: "NO_AQI_DATA" } });
    }

    // Ensure the location exists; keep zip unique
    const location = await prisma.location.upsert({
      where: { zip },
      update: {
        latitude: worstAirQualityMeasurement.latitude,
        longitude: worstAirQualityMeasurement.longitude,
        name: worstAirQualityMeasurement.name ?? undefined,
      },
      create: {
        zip,
        name: worstAirQualityMeasurement.name ?? undefined,
        latitude: worstAirQualityMeasurement.latitude,
        longitude: worstAirQualityMeasurement.longitude,
      },
      select: { id: true },
    });

    // Insert measurement
    const inserted = await prisma.measurement.create({
      data: {
        locationId: location.id,
        type: "AQI",
        value: worstAirQualityMeasurement.value,
        unit: worstAirQualityMeasurement.unit,
        source: worstAirQualityMeasurement.source,
        recordedAt: worstAirQualityMeasurement.recordedAt,
      },
      select: { value: true, unit: true, recordedAt: true, source: true },
    });

    return reply.code(200).send({ zip, ...inserted, fresh: true });
  } catch (err: any) {
    // Upstream failed: fall back to stale
    const latestAny = await prisma.measurement.findFirst({
      where: { type: "AQI", location: { zip } },
      orderBy: { recordedAt: "desc" },
      select: { value: true, unit: true, recordedAt: true, source: true },
    });
    if (latestAny) {
      return reply.code(200).send({
        zip,
        ...latestAny,
        fresh: false,
        note: "Upstream error; served cached",
      });
    }
    return reply.code(502).send({
      error: {
        code: "UPSTREAM_AIRNOW",
        message: String(err?.message ?? err),
      },
    });
  }
});

app.get("/climate-forecast", async (request, reply) => {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: "42.2808",
      longitude: "-83.7430",
      timezone: "auto",
      timeformat: "iso8601",
      past_days: "1",
      forecast_days: "7",
      wind_speed_unit: "ms",
      precipitation_unit: "mm",
      current:
        "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover",
      hourly:
        "temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,precipitation,precipitation_probability,cloud_cover,shortwave_radiation,direct_radiation,diffuse_radiation,direct_normal_irradiance,wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_80m",
      daily:
        "temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,precipitation_hours,shortwave_radiation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
    }).toString();

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return reply
        .code(502)
        .send({ error: { code: "UPSTREAM_AIRNOW", status: res.status } });
    }

    const data = await res.json();

    reply.code(200).header("Content-Type", "application/json").send(data);
  } catch (err: any) {
    request.log.error({ err }, "AirNow fetch failed");
    reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "Failed to fetch AirNow" } });
  }
});

app.get("/solar", async (request, reply) => {
  try {
    const url = new URL(
      "https://developer.nrel.gov/api/solar/solar_resource/v1.json"
    );
    url.search = new URLSearchParams({
      api_key: "af7Y3ZSfuNkwH6d99HjFxaDFgqwPASLAVesTje5n",
      lat: "34.1",
      lon: "118.3",
    }).toString();

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return reply
        .code(502)
        .send({ error: { code: "UPSTREAM_AIRNOW", status: res.status } });
    }

    const data = await res.json();

    reply.code(200).header("Content-Type", "application/json").send(data);
  } catch (err: any) {
    request.log.error({ err }, "AirNow fetch failed");
    reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "Failed to fetch AirNow" } });
  }
});

app.get("/ev-stations", async (request, reply) => {
  try {
    const url = new URL(
      "https://developer.nrel.gov/api/alt-fuel-stations/v1.json"
    );
    url.search = new URLSearchParams({
      api_key: "af7Y3ZSfuNkwH6d99HjFxaDFgqwPASLAVesTje5n",
      fuel_type_code: "ELEC",
      state: "CA",
    }).toString();

    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return reply
        .code(502)
        .send({ error: { code: "UPSTREAM_AIRNOW", status: res.status } });
    }

    const data = await res.json();

    reply.code(200).header("Content-Type", "application/json").send(data);
  } catch (err: any) {
    request.log.error({ err }, "AirNow fetch failed");
    reply
      .code(500)
      .send({ error: { code: "INTERNAL", message: "Failed to fetch AirNow" } });
  }
});

const start = async () => {
  try {
    await app.listen({ port: 3001, host: "0.0.0.0" });
    console.log("🚀 Fastify server running on http://localhost:3001");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
