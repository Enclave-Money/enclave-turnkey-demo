"use client";
import { useState } from "react";
import { Auth } from "@turnkey/sdk-react";
import { useRouter } from "next/navigation";

export default function Home() {

  const [errorMessage, setErrorMessage] = useState("");
  const router = useRouter();

  const onAuthSuccess = async () => {
    router.push("/dashboard");
  };

  const onError = (errorMessage: string) => {
    setErrorMessage(errorMessage);
  };

  const config = {
    authConfig: {
      emailEnabled: true,
      passkeyEnabled: true,
      phoneEnabled: false,
      appleEnabled: false,
      facebookEnabled: false,
      googleEnabled: false,
      walletEnabled: true,
    },
    configOrder: ["email" , "passkey"],
    onAuthSuccess: onAuthSuccess,
    onError: onError,
  };

  return (
    <div>
      <br/ >

      <Auth {...config} />
    </div>
  );
}
