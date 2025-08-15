import { prisma } from "../src/index";

async function main() {
  await prisma.location.createMany({
    data: [
      {
        zip: "90210",
        latitude: 34.0901,
        longitude: -118.4065,
        name: "Beverly Hills",
      },
      {
        zip: "10001",
        latitude: 40.7128,
        longitude: -74.006,
        name: "New York City",
      },
    ],
    skipDuplicates: true,
  });

  // Example measurement for Beverly Hills
  await prisma.measurement.create({
    data: {
      location: { connect: { zip: "90210" } },
      type: "AQI",
      value: 42,
      unit: "US AQI",
      source: "EPA",
      recordedAt: new Date(),
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
