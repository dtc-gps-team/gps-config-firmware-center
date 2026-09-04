import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateTaskButton } from "./create-task-button";
import { DemoNote } from "@/components/demo/demo-note";
import { DEMO_TASKS, TASK_STATUS_TONE, pillClass } from "@/lib/demo-data";

export const metadata = {
  title: "Task Management | GPS Config Center",
};

/**
 * Scaffold — `GET /tasks` มีจริงใน spec แล้ว (ดู RBAC_Matrix.md ตาราง 4.1)
 * แต่ยังไม่ต่อ UI ตรงนี้ — ST/OT เห็นเฉพาะ Task ที่ตัวเองถูก assign, Operation
 * เห็นทุก Task (backend กรองให้ ไม่ใช่ UI)
 */
export default function TasksPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Task Management</h1>
          <p className="text-sm text-muted-foreground">
            มอบหมายงานช่าง — สร้าง/มอบหมายได้เฉพาะ Role Operation
          </p>
        </div>
        <CreateTaskButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>รายการ Task</CardTitle>
          <CardDescription>
            Operation เห็นทุก Task — ST/OT เห็นเฉพาะงานที่ตัวเองถูกมอบหมาย
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DemoNote endpoint="GET /tasks" />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>งาน</TableHead>
                <TableHead>มอบหมายให้</TableHead>
                <TableHead>อุปกรณ์</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DEMO_TASKS.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.assignee}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {task.device}
                  </TableCell>
                  <TableCell>
                    <span className={pillClass(TASK_STATUS_TONE[task.status])}>
                      {task.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
