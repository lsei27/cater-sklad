import { Link } from "react-router-dom";
import Button from "./ui/Button";
import { Card, CardContent } from "./ui/Card";

export default function EventLoadError({ message, back, retry }: {
  message: string;
  back: "/events" | "/warehouse";
  retry: () => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <p role="alert" className="text-sm text-red-700">{message}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={retry}>Zkusit znovu</Button>
          <Link to={back} className="text-sm font-medium text-indigo-700">Zpět na přehled</Link>
        </div>
      </CardContent>
    </Card>
  );
}
