import Fastify from "fastify";
import {prisma} from 'prisma-database';
import exampleRoutes from "./routes/example";

const app = Fastify({ logger: true });
  app.register(exampleRoutes);


app.get("/ping", async (request, reply) => {
  return { pong: true };
});

app.get('/readings', async (request, reply) => {
  const readings = await prisma.location.findMany();
  return readings;
});

app.get('/air-quality-index', async (request, reply) => {
  try {
    const url = new URL('https://www.airnowapi.org/aq/observation/zipCode/current/');
    url.search = new URLSearchParams({
      format: 'application/json',
      zipCode: '90210',
      distance: '25',
      API_KEY: '2417D6CA-D0D2-470C-BD0E-CB049A7B944A'
    }).toString();

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return reply.code(502).send({ error: { code: 'UPSTREAM_AIRNOW', status: res.status } });
    }

    const data = await res.json();

    reply
      .code(200)
      .header('Content-Type', 'application/json')
      .send(data);
  } catch (err: any) {
    request.log.error({ err }, 'AirNow fetch failed');
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'Failed to fetch AirNow' } });
  }
});

app.get('/climate-forecast', async(request, reply)=>{
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.search = new URLSearchParams({
      latitude: '42.2808',
      longitude: '-83.7430',
      timezone: 'auto',
      timeformat: 'iso8601',
      past_days: '1',
      forecast_days: '7',
      wind_speed_unit: 'ms',
      precipitation_unit: 'mm',
      current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover',
      hourly: 'temperature_2m,apparent_temperature,dew_point_2m,relative_humidity_2m,precipitation,precipitation_probability,cloud_cover,shortwave_radiation,direct_radiation,diffuse_radiation,direct_normal_irradiance,wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_80m',
      daily: 'temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,precipitation_hours,shortwave_radiation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset'
    }).toString();

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return reply.code(502).send({ error: { code: 'UPSTREAM_AIRNOW', status: res.status } });
    }

    const data = await res.json();

    reply
      .code(200)
      .header('Content-Type', 'application/json')
      .send(data);
  } catch (err: any) {
    request.log.error({ err }, 'AirNow fetch failed');
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'Failed to fetch AirNow' } });
  }
})

app.get('/solar', async(request, reply)=>{
  try {
    const url = new URL('https://developer.nrel.gov/api/solar/solar_resource/v1.json');
    url.search = new URLSearchParams({
      api_key: 'af7Y3ZSfuNkwH6d99HjFxaDFgqwPASLAVesTje5n',
      lat: '34.1',
      lon: '118.3',
    }).toString();

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return reply.code(502).send({ error: { code: 'UPSTREAM_AIRNOW', status: res.status } });
    }

    const data = await res.json();

    reply
      .code(200)
      .header('Content-Type', 'application/json')
      .send(data);
  } catch (err: any) {
    request.log.error({ err }, 'AirNow fetch failed');
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'Failed to fetch AirNow' } });
  }
})

app.get('/ev-stations', async(request, reply)=>{
  try {
    const url = new URL('https://developer.nrel.gov/api/alt-fuel-stations/v1.json');
    url.search = new URLSearchParams({
      api_key: 'af7Y3ZSfuNkwH6d99HjFxaDFgqwPASLAVesTje5n',
      fuel_type_code: 'ELEC',
      state: 'CA',
    }).toString();

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return reply.code(502).send({ error: { code: 'UPSTREAM_AIRNOW', status: res.status } });
    }

    const data = await res.json();

    reply
      .code(200)
      .header('Content-Type', 'application/json')
      .send(data);
  } catch (err: any) {
    request.log.error({ err }, 'AirNow fetch failed');
    reply.code(500).send({ error: { code: 'INTERNAL', message: 'Failed to fetch AirNow' } });
  }
})


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
