/** Prints the four demo accounts and their testnet balances. */
import "dotenv/config";
import { accountUrl, disconnect, getBalanceXrp, getWallets } from "../src/xrpl/client.js";

const wallets = await getWallets();
for (const role of ["buyer", "agent", "supplier", "merchant"] as const) {
  const address = wallets[role].address;
  console.log(role.padEnd(9), String(await getBalanceXrp(address)).padStart(10), "XRP  ", accountUrl(address));
}
await disconnect();
