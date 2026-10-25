import { permanentRedirect } from "next/navigation";
export default function HomeAlias() {
  permanentRedirect("/");
}
