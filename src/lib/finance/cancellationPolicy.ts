export function applyCancellationTimingPolicy(params: {
  status: string;
  insideFreeWindow: boolean;
  feeAmount: number;
  driverAmount: number;
  moovuAmount: number;
}) {
  if (params.insideFreeWindow) {
    return { charge: false, driverAmount: 0, moovuAmount: 0 };
  }

  if (params.status === "requested" || params.status === "offered") {
    return {
      charge: true,
      driverAmount: 0,
      moovuAmount: params.feeAmount,
    };
  }

  if (params.status === "assigned" || params.status === "arrived") {
    return {
      charge: true,
      driverAmount: params.driverAmount,
      moovuAmount: params.moovuAmount,
    };
  }

  return { charge: false, driverAmount: 0, moovuAmount: 0 };
}
